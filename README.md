# Common Attack Vectors

This repository lists common vulnerabilities in Solana programs and explains how they can be exploited and prevented. Each section includes examples and proof-of-concept tests to demonstrate the issues.

## Table of Contents
<!-- no toc -->
- [How to Run POC Tests](#how-to-run-poc-tests)
- [Account Data Matching](#account-data-matching)
- [Account Reloading](#account-reloading)
- [Arbitrary CPI](#arbitrary-cpi)
- [Duplicate Mutable Accounts](#duplicate-mutable-accounts)
- [Initialization Frontrunning](#initialization-frontrunning)
- [Ownership Check](#ownership-check)
- [Pda Privileges](#pda-privileges)
- [Re-Initialization](#re-initialization)
- [Revival Attack](#revival-attack)
- [Signer Authorization](#signer-authorization)
- [Type Cosplay](#type-cosplay)
- [Additional Resources](#additional-resources)

## How to Run POC Tests

To run POC tests:

1. Navigate to the root directory of the example program.
2. Install the dependencies using `yarn install`.
3. Run the tests using `anchor test`.

## Account Data Matching

This issue occurs when we don't verify that an account contains the expected data before performing updates or actions. In this case, the program does not ensure that the correct vault's `data` field is being updated, which could allow unintended or unauthorized changes.

```rust
pub fn update_vault_data_insecure(ctx: Context<UpdateVaultAuthorityInsecure>, new_data: u8) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    vault.data = new_data;

    Ok(())
}
```

### Solution

To fix this issue, we verify that the correct vault's data is being updated by checking whether `vault_authority` matches the address of the account attempting to update the `data` field.

```rust
pub fn update_vault_data_secure(ctx: Context<UpdateVaultAuthoritySecure>, new_data: u8) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    if vault.vault_authority != ctx.accounts.vault_authority.key() {
        return Err(AccountDataMatchingError::UnauthorizedVaultDataUpdate.into());
    }

    vault.data = new_data;

    Ok(())
}
```

It is also possible to enforce the validation with the use of Anchor's `constraint` attribute.

```rust
#[account(
    mut,
    constraint = vault.vault_authority == vault_authority.key(),
)]
pub vault: Account<'info, Vault>
```

[Program](./account-data-matching/programs/)<br>
[Proof of Concept](./account-data-matching/tests/account-data-matching.ts)

## Account Reloading

Accounts modified within a CPI (Cross-Program Invocation) are not automatically updated. If you want to continue working with the updated accounts after they have been modified by the CPI, you need to reload them manually.

```rust
pub fn update_cpi_noreload(ctx: Context<UpdateCPI>, new_input: u8) -> Result<()> {
    ...
    let cpi_context = CpiContext::new(
        ctx.accounts.update_account.to_account_info(),
        update_account::cpi::accounts::Update {
            authority: ctx.accounts.authority.to_account_info(),
            metadata: ctx.accounts.metadata.to_account_info(),
        },
    );

    update_account::cpi::update(cpi_context, new_input)?;
    ...
}
```

### Solution

The fix is straightforward: always call `reload()` on any account you wish to continue using after it has been modified by the CPI.

```rust
pub fn update_cpi_reload(ctx: Context<UpdateCPI>, new_input: u8) -> Result<()> {
    ...
    let cpi_context = CpiContext::new(
        ctx.accounts.update_account.to_account_info(),
        update_account::cpi::accounts::Update {
            authority: ctx.accounts.authority.to_account_info(),
            metadata: ctx.accounts.metadata.to_account_info(),
        },
    );

    update_account::cpi::update(cpi_context, new_input)?;

    ctx.accounts.metadata.reload()?;
    ...
}
```

[Program](./account-reloading/programs/)<br>
[Proof of Concept](./account-reloading/tests/account-reloading.ts)

## Arbitrary CPI

Attackers can pass not only malicious accounts to your program but also a malicious program. If you do not verify that you are calling the correct program before performing a CPI, you give attackers full control over the CPI's behavior. This could allow them to implement their own logic and manipulate the accounts involved in the CPI.

```rust
pub fn insecure_verify_pin(
    ctx: Context<InsecureVerifyPinCPI>,
    ...
) -> Result<()> {
    let cpi_program = ctx.accounts.secret_program.to_account_info();

    let cpi_accounts = VerifyPin {
        author: ctx.accounts.author.to_account_info(),
        secret_information: ctx.accounts.secret_information.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

    arbitrary_cpi_expected::cpi::verify_pin(cpi_ctx, pin1, pin2, pin3, pin4)?;
    ...
}
```

### Solution

Always verify the `program ID` before performing a CPI to make sure that you are invoking the right program.

```rust
pub fn secure_verify_pin(
    ctx: Context<SecureVerifyPinCPI>,
    ...
) -> Result<()> {
    let cpi_program = ctx.accounts.secret_program.to_account_info();

    if cpi_program.key() != arbitrary_cpi_expected::ID {
        return err!(ArbitraryCPIError::CPIProgramIDMismatch);
    }
    ...
}
```

[Program](./arbitrary-cpi/programs/)<br>
[Proof of Concept](./arbitrary-cpi/tests/arbitrary-cpi.ts)

## Duplicate Mutable Accounts

When your instructions work with more than one mutable account of the same type, an attacker can exploit this by passing the same account multiple times. This can result in unintended behavior, such as incorrect state updates.

```rust
pub fn insecure_atomic_trade(ctx: Context<AtomicTrade>, transfer_amount: u64) -> Result<()> {
    ...
    let fee = transfer_amount
        .checked_mul(FEE_BPS)
        .unwrap()
        .checked_div(BPS)
        .unwrap();

    let fee_deducted = transfer_amount.checked_sub(fee).unwrap();

    fee_vault.amount = fee_vault.amount.checked_add(fee).unwrap();
    vault_a.amount = vault_a.amount.checked_add(fee_deducted).unwrap();
    vault_b.amount = vault_b.amount.checked_sub(fee_deducted).unwrap();
    ...
}
```

### Solution

To prevent this issue, add a simple check to ensure that the accounts don't match before performing any operations.

```rust
pub fn secure_atomic_trade(ctx: Context<AtomicTrade>, transfer_amount: u64) -> Result<()> {
    ...
    if vault_a.key() == vault_b.key() {
        return err!(AtomicTradeError::DuplicateVaults);
    }

    let fee = transfer_amount
        .checked_mul(FEE_BPS)
        .unwrap()
        .checked_div(BPS)
        .unwrap();
    ...
}
```

You can achieve the same result using Anchor's `constraint` attribute.

```rust
#[account(
    ...
    constraint = vault_a.key() != vault_b.key() @ AtomicTradeError::DuplicateVaults,
    ...
)]
pub vault_a: Account<'info, Vault>
```

[Program](./duplicate-mutable-accounts/programs/)<br>
[Proof of Concept](./duplicate-mutable-accounts/tests/duplicate-mutable-accounts.ts)

## Initialization Frontrunning

Frontrunning occurs when an attacker inserts a malicious instruction ahead of yours, exploiting vulnerabilities in your program's logic. In our case, a global config is being initialized without verifying the initializer's identity, an attacker can front-run the instruction and initialize the configuration account, leading to a denial of service.

```rust
#[derive(Accounts)]
pub struct InitializeInsecure<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(
        init,
        payer = signer,
        space = 8 + GlobalConfig::INIT_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub global_config: Account<'info, GlobalConfig>,
    pub system_program: Program<'info, System>,
}
```

### Solution

Include a check to ensure that only the program's upgrade authority is able to initialize the config account.

```rust
#[derive(Accounts)]
pub struct InitializeSecure<'info> {
    #[account(
        mut,
        constraint = signer.key() == program_data.upgrade_authority_address.unwrap_or_default()
    )]
    pub signer: Signer<'info>,
    #[account(
        init,
        payer = signer,
        space = 8 + GlobalConfig::INIT_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        seeds = [crate::ID.as_ref()],
        bump,
        seeds::program = bpf_loader_upgradeable::id(),
    )]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}
```

[Program](./initialization-frontrunning/programs/)<br>
[Proof of Concept](./initialization-frontrunning/tests/initialization-frontrunning.ts)

## Ownership Check

Unless we verify owner of the account, an attacker can pass in any malicious account of the same type to exploit the instruction. The instruction below doesn't verify the ownership of the `token_account` or its association with the `mint`. Without these checks, an attacker could pass in malicious token accounts, enabling unauthorized actions, such as accessing funds not owned by the signer.

```rust
pub fn insecure_log_balance_v1(ctx: Context<InsecureOwnershipv1>) -> Result<()> {
    msg!(
        "The balance: {} of Token Account: {} corresponds to owner: {} and Mint: {}",
        ctx.accounts.token_account.amount,
        ctx.accounts.token_account.key(),
        ctx.accounts.token_account_owner.key(),
        ctx.accounts.mint.key(),
    );
    Ok(())
}

#[derive(Accounts)]
pub struct InsecureOwnershipv1<'info> {
    pub mint: Account<'info, Mint>,
    pub token_account: Account<'info, TokenAccount>,
    pub token_account_owner: Signer<'info>,
}
```

### Solution

Use constraints to enforce that the `token_account` is owned by the `token_account_owner` and belongs to the provided mint. This ensures that only the rightful owner of the account can perform actions.

```rust
#[derive(Accounts)]
pub struct SecureOwnershipv1<'info> {
    pub mint: Account<'info, Mint>,
    #[account(
        token::authority = token_account_owner,
        token::mint = mint
    )]
    pub token_account: Account<'info, TokenAccount>,
    pub token_account_owner: Signer<'info>,
}
```

[Program](./ownership-check/programs/)

## Pda Privileges

PDAs (Program Derived Addresses) can sign transactions. Without proper constraints, attackers can exploit this to perform unauthorized actions. In this example, we are using `metadata_account` to sign `transfer` instruction. Since there are no safeguards verifying that the `creator` is authorized to use the `metadata_account`, an attacker could create a transaction that exploits someone else's `metadata_account` to withdraw funds from the vault.

```rust
pub fn insecure_withdraw(ctx: Context<InsecureWithdraw>) -> Result<()> {
    ...
    let signer_seeds: &[&[&[u8]]] = &[&[b"metadata_account", metadata_account.creator.as_ref(), &[ctx.bumps.metadata_account]]];

    let cpi_context = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.withdraw_destination.to_account_info(),
            authority: metadata_account.to_account_info(),
        },
        signer_seeds,
    );
    transfer(cpi_context, amount)?;
    ...
}

#[derive(Accounts)]
pub struct InsecureWithdraw<'info> {
    pub creator: Signer<'info>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = metadata_account,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
    )]
    pub withdraw_destination: Account<'info, TokenAccount>,
    #[account(
        seeds = [b"metadata_account",metadata_account.creator.key().as_ref()],
        bump,
    )]
    pub metadata_account: Account<'info, MetadataAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}
```

### Solution

Use the `has_one` attribute to ensure the `metadata_account` is tied to the `creator`. This prevents unauthorized access by verifying that the `metadata_account.creator` matches the `creator` provided in the transaction.

```rust
#[derive(Accounts)]
pub struct SecureWithdraw<'info> {
    pub creator: Signer<'info>,
    ...
    #[account(
        seeds = [b"metadata_account",metadata_account.creator.key().as_ref()],
        bump,
        has_one = creator,
    )]
    pub metadata_account: Account<'info, MetadataAccount>,
    ...
}
```

[Program](./pda-privileges/programs/)<br>
[Proof of Concept](./pda-privileges/tests/pda-privileges.ts)

## Re-Initialization

Using the `init_if_needed` constraint without additional safeguards can leave your program vulnerable to re-initialization attacks. An attacker can invoke the instruction again to reinitialize an account, potentially overwriting its data and causing unintended behavior.

```rust
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init_if_needed,
        payer=creator,
        space = 8+Metadata::LEN,
        seeds=[b"metadata"],
        bump
    )]
    pub metadata: Account<'info, Metadata>,
    pub system_program: Program<'info, System>,
}

pub fn insecure_initializev1(
    ctx: Context<Initialize>,
    parameters: InitializeParameters,
) -> Result<()> {
    let metadata = &mut ctx.accounts.metadata;

    metadata.creator = ctx.accounts.creator.key();
    metadata.name = parameters.name;
    metadata.symbol = parameters.symbol;
    metadata.uri = parameters.uri;
    metadata.year_of_creation = parameters.year_of_creation;
    Ok(())
}
```

### Solution

Ideally, avoid using `init_if_needed` constraint. If you do, implement an `is_initialized` flag yourself to track the account's status. Before initializing the account, always check this flag to prevent re-initialization.

```rust
pub fn secure_initialize(
    ctx: Context<Initialize>,
    parameters: InitializeParameters,
) -> Result<()> {
    let metadata = &mut ctx.accounts.metadata;

    if !metadata.is_initialized {
        metadata.creator = ctx.accounts.creator.key();
        metadata.name = parameters.name;
        metadata.symbol = parameters.symbol;
        metadata.uri = parameters.uri;
        metadata.year_of_creation = parameters.year_of_creation;
        metadata.is_initialized = true;
    } else {
        panic!("Account already Initialized")
    }
    Ok(())
}
```

[Program](./re-initialization/programs/)<br>
[Proof of Concept](./re-initialization/tests/re-initialization.ts)

## Revival Attack

It isn't enough to close the account by transferring its lamports and zeroing its data. An attacker can send lamports to the account to revive it, which could lead to a denial of service.

```rust
pub fn close_metadata(ctx: Context<CloseMetadata>) -> Result<()> {
    let metadata = &mut ctx.accounts.metadata;
    let creator = &mut ctx.accounts.creator;

    metadata.remove_metadata();

    let metadata_balance = metadata.get_lamports();

    metadata.sub_lamports(metadata_balance)?;
    creator.add_lamports(metadata_balance)?;
    ...
}

#[derive(Accounts)]
pub struct CloseMetadata<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        mut,
        seeds=[b"secret_metadata",creator.key().as_ref()],
        bump,
    )]
    pub metadata: Account<'info, SecretMetadata>,
}
```

### Solution

Use Anchor's `close` constraint to securely close accounts! This constraint:

1. Transfers all lamports from the account to a designated recipient.
2. Zeroes out the account's data.
3. Sets the account discriminator to `CLOSED_ACCOUNT_DISCRIMINATOR`, which prevents any future attempts to revive it.

```rust
pub fn close_metadata(ctx: Context<CloseMetadata>) -> Result<()> {
    msg!("Metadata Removed");

    Ok(())
}

#[derive(Accounts)]
pub struct CloseMetadata<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        mut,
        close=creator,
        seeds=[b"secret_metadata",creator.key().as_ref()],
        bump,
    )]
    pub metadata: Account<'info, SecretMetadata>,
}
```

[Program](./revival-attack/programs/)<br>
[Proof of Concept](./revival-attack/tests/revival-attack.ts)

## Signer Authorization

Having a signer for an instruction doesn't automatically verify their authority. Without a check, any signer can potentially perform unauthorized actions. In this example, anyone can modify the `data` field because there is no validation ensuring that the signer's address matches the `authority` field in the `Escrow` account.

```rust
pub fn insecure_authorization(ctx: Context<InsecureAuthorization>, data: u8) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow;
    escrow.data = data;
    ...
}

#[derive(Accounts)]
pub struct InsecureAuthorization<'info> {
    pub authority: Signer<'info>,
    /// CHECK: This is not correct
    #[account(
        mut,
        seeds = [b"escrow".as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
}

#[account]
pub struct Escrow {
    pub authority: Pubkey,
    pub data: u8,
}
```

### Solution

To ensure proper authorization:

1. Use Anchor's `has_one` constraint to enforce that the `Escrow` account's authority matches the signer's address.
2. Manually validate the authority within the instruction.

```rust
pub fn secure_authorization(ctx: Context<SecureAuthorization>, data: u8) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow;

    if escrow.authority != ctx.accounts.authority.key() {
        ...
    }

    escrow.data = data;
    ...
}

#[derive(Accounts)]
pub struct SecureAuthorization<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow".as_ref()],
        bump,
        has_one = authority
    )]
    pub escrow: Account<'info, Escrow>,
}
```

[Program](./signer-authorization/programs/)<br>
[Proof of Concept](./signer-authorization/tests/signer-authorization.ts)

## Type Cosplay

Accounts with the same byte size can be incorrectly deserialized into each other's types. For example, consider the `User` and `UserMetadata` structs, both of which occupy **68** bytes.

```rust
#[account]
pub struct User {
    pub authority: Pubkey,
    pub metadata_account: Pubkey,
    pub age: u32,
}

#[account]
pub struct UserMetadata {
    pub authority: Pubkey,
    pub user_account: Pubkey,
    pub pin1: u8,
    pub pin2: u8,
    pub pin3: u8,
    pub pin4: u8,
}
```

Because `UserMetadata` has the same size as `User`, it can be deserialized into `User` without error if no type-checking mechanism is in place. This is possible because there’s no discriminator to ensure the account being deserialized matches the expected type.

```rust
pub fn insecure_user_read(ctx: Context<InsecureTypeCosplay>) -> Result<()> {
    let user = User::try_from_slice(&ctx.accounts.user.data.borrow())?;
    ...
}

#[derive(Accounts)]
pub struct InsecureTypeCosplay<'info> {
    /// CHECK: unsafe, does not check the Account type
    pub user: AccountInfo<'info>,
    pub authority: Signer<'info>,
}
```


### Solution

To prevent type cosplay, you can:

1. Implement account discriminators manually.
2. Specify the account type within the instruction context.

Anchor prepends a discriminator to each account and checks its type before deserializing it. This is why Anchor requires allocating 8 extra bytes when initializing accounts.

```rust
pub fn secure_user_read(ctx: Context<SecureTypeCosplay>) -> Result<()> {
    let user = &ctx.accounts.user;
    ...
}

#[derive(Accounts)]
pub struct SecureTypeCosplay<'info> {
    #[account(
        has_one = authority,
    )]
    pub user: Account<'info, User>,
    pub authority: Signer<'info>,
}
```

[Program](./type-cosplay/programs/)

## Additional Resources
- [Common Vulnerability Vectors in Solana Programs](https://youtu.be/ZvON2fr9MX0)
- [A Hitchhiker's Guide to Solana Program Security](https://www.helius.dev/blog/a-hitchhikers-guide-to-solana-program-security)

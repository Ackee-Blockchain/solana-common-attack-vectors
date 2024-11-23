use anchor_lang::prelude::*;

declare_id!("G89cLRPVSKmXsYVZVRASfANWpDy84Qy8tPYux5yg6VWV");

#[program]
pub mod account_data_matching {
    use super::*;

    pub fn initialize_vault(ctx: Context<InitializeVault>, vault_data: u8) -> Result<()> {
        let vault = &mut ctx.accounts.vault;

        vault.vault_authority = ctx.accounts.vault_authority.key();
        vault.data = vault_data;

        Ok(())
    }

    pub fn update_vault_data_insecure(ctx: Context<UpdateVaultAuthorityInsecure>, new_data: u8) -> Result<()> {
        let vault = &mut ctx.accounts.vault;

        vault.data = new_data;

        Ok(())
    }

    pub fn update_vault_data_secure(ctx: Context<UpdateVaultAuthoritySecure>, new_data: u8) -> Result<()> {
        let vault = &mut ctx.accounts.vault;

        if vault.vault_authority != ctx.accounts.vault_authority.key() {
            return Err(AccountDataMatchingError::UnauthorizedVaultDataUpdate.into());
        }

        vault.data = new_data;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub vault_authority: Signer<'info>,
    #[account(
        init,
        payer = vault_authority,
        space = 8 + Vault::LEN,
    )]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>
}

#[derive(Accounts)]
pub struct UpdateVaultAuthorityInsecure<'info> {
    #[account(mut)]
    pub vault_authority: Signer<'info>,
    #[account(
        mut,
    )]
    pub vault: Account<'info, Vault>,
}

#[derive(Accounts)]
pub struct UpdateVaultAuthoritySecure<'info> {
    #[account(mut)]
    pub vault_authority: Signer<'info>,
    #[account(
        mut,
        // You can use constraint to resolve the issue instead of the if statement.
        // constraint = vault.vault_authority == vault_authority.key() @ AccountDataMatchingError::UnauthorizedVaultDataUpdate,
    )]
    pub vault: Account<'info, Vault>,
}

#[account]
pub struct Vault {
    pub vault_authority: Pubkey,
    pub data: u8
}

impl Vault {
    const LEN: usize = 32 + 1;
}

#[error_code]
pub enum AccountDataMatchingError {
    #[msg("Signer doesn't match the current vault authority!")]
    UnauthorizedVaultDataUpdate,
}

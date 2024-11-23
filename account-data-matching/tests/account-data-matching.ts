import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AccountDataMatching } from "../target/types/account_data_matching";
import { assert } from "chai";
import { web3 } from "@coral-xyz/anchor";
import createStatsCollector from "mocha/lib/stats-collector";

describe("account-data-matching", () => {
  let provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .AccountDataMatching as Program<AccountDataMatching>;

  const creator = web3.Keypair.generate();
  const hacker = web3.Keypair.generate();
  const vault = web3.Keypair.generate();

  before("Fund the users!", async () => {
    await airdrop(provider.connection, creator.publicKey);
    await airdrop(provider.connection, hacker.publicKey);
  });

  const VAULT_DATA = 7;
  const NEW_VAULT_DATA_INSECURE = 29;
  const NEW_VAULT_DATA_SECURE = 13;

  // x x x x x x x x x x x x x x x x x x x x x
  // | | | | | | | | | | | | | | | | | | | | |
  //           ADD YOUR CODE BELOW
  // | | | | | | | | | | | | | | | | | | | | |
  // v v v v v v v v v v v v v v v v v v v v v

  it("Initialize Vault", async () => {
    await program.methods
      .initializeVault(VAULT_DATA)
      .accounts({
        vaultAuthority: creator.publicKey,
        vault: vault.publicKey,
      })
      .signers([creator, vault])
      .rpc({ commitment: "confirmed" });

    const vaultAccountData = await program.account.vault.fetch(vault.publicKey);

    assert.strictEqual(
      creator.publicKey.toString(),
      vaultAccountData.vaultAuthority.toString()
    );
    assert.strictEqual(VAULT_DATA, vaultAccountData.data);
  });

  it("Insecure Data Update", async () => {
    await program.methods
      .updateVaultDataInsecure(NEW_VAULT_DATA_INSECURE)
      .accounts({
        vaultAuthority: hacker.publicKey,
        vault: vault.publicKey,
      })
      .signers([hacker])
      .rpc({ commitment: "confirmed" });

    const vaultAccountData = await program.account.vault.fetch(vault.publicKey);

    assert.strictEqual(
      creator.publicKey.toString(),
      vaultAccountData.vaultAuthority.toString()
    );
    assert.strictEqual(NEW_VAULT_DATA_INSECURE, vaultAccountData.data);
  });

  it("Secure Data Update Unhappy Case", async () => {
    try {
      await program.methods
        .updateVaultDataSecure(NEW_VAULT_DATA_SECURE)
        .accounts({
          vaultAuthority: hacker.publicKey,
          vault: vault.publicKey,
        })
        .signers([hacker])
        .rpc({ commitment: "confirmed" });
    } catch (error) {
      const err = anchor.AnchorError.parse(error.logs);
      assert.strictEqual(err.error.errorCode.code, "UnauthorizedVaultDataUpdate");
    }

    const vaultAccountData = await program.account.vault.fetch(vault.publicKey);

    assert.strictEqual(
      creator.publicKey.toString(),
      vaultAccountData.vaultAuthority.toString()
    );
    assert.strictEqual(NEW_VAULT_DATA_INSECURE, vaultAccountData.data);
  });

  it("Secure Data Update Happy Case", async () => {
    await program.methods
      .updateVaultDataSecure(NEW_VAULT_DATA_SECURE)
      .accounts({
        vaultAuthority: creator.publicKey,
        vault: vault.publicKey,
      })
      .signers([creator])
      .rpc({ commitment: "confirmed" });

    const vaultAccountData = await program.account.vault.fetch(vault.publicKey);

    assert.strictEqual(
      creator.publicKey.toString(),
      vaultAccountData.vaultAuthority.toString()
    );
    assert.strictEqual(NEW_VAULT_DATA_SECURE, vaultAccountData.data);
  });

  // ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^
  // | | | | | | | | | | | | | | | | | | | | |
  //           ADD YOUR CODE ABOVE
  // | | | | | | | | | | | | | | | | | | | | |
  // x x x x x x x x x x x x x x x x x x x x x
});
export async function airdrop(
  connection: any,
  address: any,
  amount = 500_000_000_000
) {
  await connection.confirmTransaction(
    await connection.requestAirdrop(address, amount),
    "confirmed"
  );
}

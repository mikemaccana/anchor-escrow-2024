import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { AnchorEscrow } from "../target/types/anchor_escrow";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import { randomBytes } from "crypto";
import { getExplorerLink, makeKeypairs } from "@solana-developers/helpers";

const TOKEN_PROGRAM: typeof TOKEN_2022_PROGRAM_ID | typeof TOKEN_PROGRAM_ID =
  TOKEN_2022_PROGRAM_ID;

describe("anchor-escrow", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const provider = anchor.getProvider();

  const connection = provider.connection;

  const program = anchor.workspace.AnchorEscrow as Program<AnchorEscrow>;

  const confirm = async (signature: string): Promise<string> => {
    const block = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
      signature,
      ...block,
    });
    return signature;
  };

  const seed = new BN(randomBytes(8));

  const [maker, taker, mintA, mintB] = makeKeypairs(4);

  const [makerAtaA, makerAtaB, takerAtaA, takerAtaB] = [maker, taker]
    .map((keypair) =>
      [mintA, mintB].map((mint) =>
        getAssociatedTokenAddressSync(
          mint.publicKey,
          keypair.publicKey,
          false,
          TOKEN_PROGRAM,
        ),
      ),
    )
    .flat();

  const escrow = PublicKey.findProgramAddressSync(
    [
      Buffer.from("escrow"),
      maker.publicKey.toBuffer(),
      seed.toArrayLike(Buffer, "le", 8),
    ],
    program.programId,
  )[0];

  const vault = getAssociatedTokenAddressSync(
    mintA.publicKey,
    escrow,
    true,
    TOKEN_PROGRAM,
  );

  // Accounts
  const accounts = {
    maker: maker.publicKey,
    taker: taker.publicKey,
    mintA: mintA.publicKey,
    mintB: mintB.publicKey,
    makerAtaA,
    makerAtaB,
    takerAtaA,
    takerAtaB,
    escrow,
    vault,
    tokenProgram: TOKEN_PROGRAM,
  };

  it("Airdrop and create mints", async () => {
    let lamports = await getMinimumBalanceForRentExemptMint(connection);
    let tx = new Transaction();
    tx.instructions = [
      ...[maker, taker].map((account) =>
        SystemProgram.transfer({
          fromPubkey: provider.publicKey,
          toPubkey: account.publicKey,
          lamports: 10 * LAMPORTS_PER_SOL,
        }),
      ),
      ...[mintA, mintB].map((mint) =>
        SystemProgram.createAccount({
          fromPubkey: provider.publicKey,
          newAccountPubkey: mint.publicKey,
          lamports,
          space: MINT_SIZE,
          programId: TOKEN_PROGRAM,
        }),
      ),
      ...[
        { mint: mintA.publicKey, authority: maker.publicKey, ata: makerAtaA },
        { mint: mintB.publicKey, authority: taker.publicKey, ata: takerAtaB },
      ].flatMap((x) => [
        createInitializeMint2Instruction(
          x.mint,
          6,
          x.authority,
          null,
          TOKEN_PROGRAM,
        ),
        createAssociatedTokenAccountIdempotentInstruction(
          provider.publicKey,
          x.ata,
          x.authority,
          x.mint,
          TOKEN_PROGRAM,
        ),
        createMintToInstruction(
          x.mint,
          x.ata,
          x.authority,
          1e9,
          undefined,
          TOKEN_PROGRAM,
        ),
      ]),
    ];

    const transactionSignature = await provider.sendAndConfirm(tx, [
      mintA,
      mintB,
      maker,
      taker,
    ]);

    console.log(getExplorerLink("transaction", transactionSignature));
  });

  const make = async () => {
    const transactionSignature = await program.methods
      .make(seed, new BN(1e6), new BN(1e6))
      .accounts({ ...accounts })
      .signers([maker])
      .rpc();

    await confirm(transactionSignature);
    console.log(getExplorerLink("transaction", transactionSignature));
  };

  const take = async () => {
    const transactionSignature = await program.methods
      .take()
      .accounts({ ...accounts })
      .signers([taker])
      .rpc();

    await confirm(transactionSignature);
    console.log(getExplorerLink("transaction", transactionSignature));
  };

  const refund = async () => {
    const transactionSignature = await program.methods
      .refund()
      .accounts({ ...accounts })
      .signers([maker])
      .rpc();

    await confirm(transactionSignature);
    console.log(getExplorerLink("transaction", transactionSignature));
  };

  it("Makes an offer and refunds it successfully", async () => {
    await make();
    await refund();
  });

  it("Makes an offer and then takes it ", async () => {
    await make();
    await take();
  });
});

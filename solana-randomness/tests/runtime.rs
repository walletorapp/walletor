use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use solana_account::Account;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;
use walletor_randomness::{instruction, Draw, ID};

// Executes the actual SBF build, including Anchor account constraints. A unit
// test of Draw::fulfill alone would miss a missing callback signer constraint.
#[test]
fn compiled_program_rejects_forged_callback() {
    let mut svm = LiteSVM::new();
    let program = Address::from(ID.to_bytes());
    svm.add_program_from_file(program, "target/deploy/walletor_randomness.so")
        .unwrap();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    let (address, bump) =
        Address::find_program_address(&[b"draw", payer.pubkey().as_ref(), &[1; 32]], &program);
    let mut data = Vec::new();
    Draw {
        authority: anchor_lang::prelude::Pubkey::new_from_array(payer.pubkey().to_bytes()),
        round_hash: [1; 32],
        snapshot_hash: [2; 32],
        requested_slot: 1,
        bump,
        version: 1,
        ..Draw::default()
    }
    .try_serialize(&mut data)
    .unwrap();
    svm.set_account(
        address,
        Account {
            lamports: 10_000_000,
            data: data.clone(),
            owner: program,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
    let ix = Instruction {
        program_id: program,
        // A real signer, but NOT MagicBlock's scoped program identity.
        accounts: vec![
            AccountMeta::new_readonly(payer.pubkey(), true),
            AccountMeta::new(address, false),
        ],
        data: instruction::ConsumeDraw {
            randomness: [3; 32],
            round_hash: [1; 32],
            snapshot_hash: [2; 32],
        }
        .data(),
    };
    let tx = Transaction::new(
        &[&payer],
        Message::new(&[ix], Some(&payer.pubkey())),
        svm.latest_blockhash(),
    );
    let failure = svm.send_transaction(tx).unwrap_err();
    assert!(
        failure
            .meta
            .logs
            .iter()
            .any(|line| line.contains("ConstraintAddress")),
        "{:?}",
        failure.meta.logs
    );
    assert_eq!(svm.get_account(&address).unwrap().data, data);
}

#[test]
fn request_callback_and_duplicate_rejection_in_runtime() {
    let mut svm = LiteSVM::new();
    svm.warp_to_slot(100);
    let program = Address::from(ID.to_bytes());
    let vrf = Address::from(ephemeral_vrf_sdk::consts::VRF_PROGRAM_ID.to_bytes());
    let queue = Address::from(ephemeral_vrf_sdk::consts::DEFAULT_QUEUE.to_bytes());
    svm.add_program_from_file(program, "target/deploy/walletor_randomness.so")
        .unwrap();
    svm.add_program_from_file(vrf, "test-oracle/target/deploy/walletor_test_oracle.so")
        .unwrap();
    svm.set_account(
        queue,
        Account {
            lamports: 1_000_000,
            data: vec![],
            owner: vrf,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    let (draw, _) =
        Address::find_program_address(&[b"draw", payer.pubkey().as_ref(), &[1; 32]], &program);
    let identity = Address::find_program_address(&[b"identity"], &program).0;
    let scoped_identity = Address::find_program_address(&[b"identity", program.as_ref()], &vrf).0;
    let key = |address: Address| anchor_lang::prelude::Pubkey::new_from_array(address.to_bytes());
    let accounts = walletor_randomness::accounts::RequestDraw {
        payer: key(payer.pubkey()),
        draw: key(draw),
        oracle_queue: key(queue),
        program_identity: key(identity),
        vrf_program: key(vrf),
        slot_hashes: ephemeral_vrf_sdk::compat::slot_hashes::ID,
        system_program: anchor_lang::solana_program::system_program::ID,
    }
    .to_account_metas(None)
    .into_iter()
    .map(|meta| AccountMeta {
        pubkey: Address::from(meta.pubkey.to_bytes()),
        is_signer: meta.is_signer,
        is_writable: meta.is_writable,
    })
    .collect();
    let request = Instruction {
        program_id: program,
        accounts,
        data: instruction::RequestDraw {
            round_hash: [1; 32],
            snapshot_hash: [2; 32],
        }
        .data(),
    };
    let tx = Transaction::new(
        &[&payer],
        Message::new(&[request.clone()], Some(&payer.pubkey())),
        svm.latest_blockhash(),
    );
    svm.send_transaction(tx).unwrap();
    let initial = svm.get_account(&draw).unwrap().data;
    let state = Draw::try_deserialize(&mut initial.as_slice()).unwrap();
    assert_eq!(state.status, 0);
    assert_eq!(state.requested_slot, 100);
    svm.expire_blockhash();
    let duplicate = Transaction::new(
        &[&payer],
        Message::new(&[request], Some(&payer.pubkey())),
        svm.latest_blockhash(),
    );
    assert!(svm.send_transaction(duplicate).is_err());
    assert_eq!(svm.get_account(&draw).unwrap().data, initial);
    svm.warp_to_slot(101);
    let callback = |snapshot| Instruction {
        program_id: vrf,
        accounts: vec![
            AccountMeta::new_readonly(scoped_identity, false),
            AccountMeta::new(draw, false),
            AccountMeta::new_readonly(program, false),
        ],
        data: [
            vec![99],
            instruction::ConsumeDraw {
                randomness: [7; 32],
                round_hash: [1; 32],
                snapshot_hash: snapshot,
            }
            .data(),
        ]
        .concat(),
    };
    let wrong = Transaction::new(
        &[&payer],
        Message::new(&[callback([9; 32])], Some(&payer.pubkey())),
        svm.latest_blockhash(),
    );
    assert!(svm.send_transaction(wrong).is_err());
    let valid = Transaction::new(
        &[&payer],
        Message::new(&[callback([2; 32])], Some(&payer.pubkey())),
        svm.latest_blockhash(),
    );
    svm.send_transaction(valid).unwrap();
    let fulfilled = svm.get_account(&draw).unwrap().data;
    let state = Draw::try_deserialize(&mut fulfilled.as_slice()).unwrap();
    assert_eq!(state.status, 1);
    assert_eq!(state.randomness, [7; 32]);
    assert_eq!(state.fulfilled_slot, 101);
    svm.expire_blockhash();
    let replay = Transaction::new(
        &[&payer],
        Message::new(&[callback([2; 32])], Some(&payer.pubkey())),
        svm.latest_blockhash(),
    );
    assert!(svm.send_transaction(replay).is_err());
    assert_eq!(svm.get_account(&draw).unwrap().data, fulfilled);
}

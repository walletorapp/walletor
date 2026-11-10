//! Local LiteSVM fixture ONLY. This is not a VRF, has no proof verification,
//! and must NEVER be deployed to a public cluster.
use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    pubkey::Pubkey,
};
entrypoint!(process_instruction);
fn process_instruction(program: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    // Accept the production SDK's scoped regular-priority request.
    if data.first() == Some(&10) {
        return Ok(());
    }
    if data.first() != Some(&99) || accounts.len() != 3 {
        return Err(solana_program::program_error::ProgramError::InvalidInstructionData);
    }
    let consumer = accounts[2].key;
    let (_, bump) = Pubkey::find_program_address(&[b"identity", consumer.as_ref()], program);
    invoke_signed(
        &Instruction {
            program_id: *consumer,
            accounts: vec![
                AccountMeta::new_readonly(*accounts[0].key, true),
                AccountMeta::new(*accounts[1].key, false),
            ],
            data: data[1..].to_vec(),
        },
        accounts,
        &[&[b"identity", consumer.as_ref(), &[bump]]],
    )
}

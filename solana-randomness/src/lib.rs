use anchor_lang::prelude::*;
use ephemeral_vrf_sdk::{
    anchor::{vrf, vrf_callback},
    consts::DEFAULT_QUEUE,
    instructions::{create_request_randomness_ix, RequestRandomnessParams},
    types::SerializableAccountMeta,
};

declare_id!("DpJmR1usbiC7CaPZsfxqcMosx4ELCtgY9TXC7ijjmoY2");

#[program]
pub mod walletor_randomness {
    use super::*;

    pub fn request_draw(
        ctx: Context<RequestDraw>,
        round_hash: [u8; 32],
        snapshot_hash: [u8; 32],
    ) -> Result<()> {
        let draw = &mut ctx.accounts.draw;
        draw.authority = ctx.accounts.payer.key();
        draw.round_hash = round_hash;
        draw.snapshot_hash = snapshot_hash;
        draw.requested_slot = Clock::get()?.slot;
        draw.bump = ctx.bumps.draw;
        draw.version = 1;
        // init (not init_if_needed) makes this request unique for this authority/round.
        // There is deliberately no reset, close, cancellation, or replacement instruction.
        let ix = create_request_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: ID,
            callback_discriminator: instruction::ConsumeDraw::DISCRIMINATOR.to_vec(),
            caller_seed: round_hash,
            accounts_metas: Some(vec![SerializableAccountMeta {
                pubkey: draw.key(),
                is_signer: false,
                is_writable: true,
            }]),
            callback_args: Some([round_hash.as_slice(), snapshot_hash.as_slice()].concat()),
        });
        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
        Ok(())
    }

    pub fn consume_draw(
        ctx: Context<ConsumeDraw>,
        randomness: [u8; 32],
        round_hash: [u8; 32],
        snapshot_hash: [u8; 32],
    ) -> Result<()> {
        ctx.accounts
            .draw
            .fulfill(randomness, round_hash, snapshot_hash, Clock::get()?.slot)
    }
}

#[vrf]
#[derive(Accounts)]
#[instruction(round_hash: [u8; 32])]
pub struct RequestDraw<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init, payer = payer, space = Draw::SPACE,
        seeds = [b"draw", payer.key().as_ref(), round_hash.as_ref()], bump)]
    pub draw: Account<'info, Draw>,
    /// CHECK: Only MagicBlock's base-layer mainnet/devnet queue is allowed.
    #[account(mut, address = DEFAULT_QUEUE)]
    pub oracle_queue: UncheckedAccount<'info>,
}

// SDK 0.17.2 authenticates the per-consumer scoped VRF signer PDA.
// Never substitute the legacy global VRF identity here.
#[vrf_callback]
#[derive(Accounts)]
pub struct ConsumeDraw<'info> {
    #[account(mut, seeds = [b"draw", draw.authority.as_ref(), draw.round_hash.as_ref()], bump = draw.bump)]
    pub draw: Account<'info, Draw>,
}

#[account]
#[derive(Default)]
pub struct Draw {
    pub authority: Pubkey,
    pub round_hash: [u8; 32],
    pub snapshot_hash: [u8; 32],
    pub randomness: [u8; 32],
    pub requested_slot: u64,
    pub fulfilled_slot: u64,
    pub status: u8,
    pub bump: u8,
    pub version: u8,
}

impl Draw {
    pub const SPACE: usize = 155;

    fn fulfill(
        &mut self,
        randomness: [u8; 32],
        round: [u8; 32],
        snapshot: [u8; 32],
        slot: u64,
    ) -> Result<()> {
        require!(
            self.version == 1 && self.status == 0,
            DrawError::AlreadyFulfilled
        );
        require!(
            self.round_hash == round && self.snapshot_hash == snapshot,
            DrawError::WrongDraw
        );
        require!(slot >= self.requested_slot, DrawError::InvalidSlot);
        self.randomness = randomness;
        self.fulfilled_slot = slot;
        self.status = 1;
        Ok(())
    }
}

#[error_code]
pub enum DrawError {
    #[msg("This draw has already been fulfilled.")]
    AlreadyFulfilled,
    #[msg("The callback does not match the locked draw.")]
    WrongDraw,
    #[msg("The callback predates its request.")]
    InvalidSlot,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn result_cannot_be_replaced_or_rebound() {
        let mut draw = Draw {
            round_hash: [1; 32],
            snapshot_hash: [2; 32],
            requested_slot: 10,
            version: 1,
            ..Draw::default()
        };
        assert!(draw.fulfill([3; 32], [4; 32], [2; 32], 11).is_err());
        assert!(draw.fulfill([3; 32], [1; 32], [4; 32], 11).is_err());
        assert!(draw.fulfill([3; 32], [1; 32], [2; 32], 9).is_err());
        assert!(draw.fulfill([0; 32], [1; 32], [2; 32], 11).is_ok());
        assert!(draw.fulfill([3; 32], [1; 32], [2; 32], 12).is_err());
        assert_eq!(draw.randomness, [0; 32]);
        let mut encoded = Vec::new();
        draw.try_serialize(&mut encoded).unwrap();
        assert_eq!(encoded.len(), Draw::SPACE);
    }
}

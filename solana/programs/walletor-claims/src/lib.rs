use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use switchboard_on_demand::accounts::RandomnessAccountData;

declare_id!("9kqhszKGiX4XgP7WNM3i6mzdkvQJjfN3e7uhSzqMGbg7");

const CONFIG_SEED: &[u8] = b"config";
const ROUND_SEED: &[u8] = b"round";
const VAULT_SEED: &[u8] = b"vault";
const WINNER_SEED: &[u8] = b"winner";
const DRAW_DOMAIN: &[u8] = b"WALLETOR_DRAW_V2";
const PARTICIPANT_DOMAIN: &[u8] = b"WALLETOR_PARTICIPANT_V2";
const CLAIM_FEE_BPS: u16 = 50;
const BASIS_POINTS_DENOMINATOR: u128 = 10_000;
const MAX_WINNERS: u16 = 100;
const MAX_PARTICIPANTS: u32 = 1_000_000;
const MAX_MERKLE_PROOF_NODES: usize = 32;
const MIN_CLAIM_WINDOW_SECONDS: i64 = 60 * 60;
const MAX_CLAIM_WINDOW_SECONDS: i64 = 366 * 24 * 60 * 60;

#[program]
pub mod walletor_claims {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        coordinator: Pubkey,
        fee_recipient: Pubkey,
        switchboard_program: Pubkey,
    ) -> Result<()> {
        require_keys_neq!(
            coordinator,
            Pubkey::default(),
            WalletorError::InvalidAddress
        );
        require_keys_neq!(
            fee_recipient,
            Pubkey::default(),
            WalletorError::InvalidAddress
        );
        require_keys_neq!(
            switchboard_program,
            Pubkey::default(),
            WalletorError::InvalidAddress
        );

        let config = &mut ctx.accounts.config;
        config.version = 1;
        config.authority = ctx.accounts.authority.key();
        config.coordinator = coordinator;
        config.fee_recipient = fee_recipient;
        config.switchboard_program = switchboard_program;
        config.paused = false;
        config.bump = ctx.bumps.config;

        emit!(ConfigInitialized {
            authority: config.authority,
            coordinator,
            fee_recipient,
            switchboard_program,
        });
        Ok(())
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        new_authority: Option<Pubkey>,
        new_coordinator: Option<Pubkey>,
        new_fee_recipient: Option<Pubkey>,
        paused: Option<bool>,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        if let Some(authority) = new_authority {
            require_keys_neq!(authority, Pubkey::default(), WalletorError::InvalidAddress);
            config.authority = authority;
        }
        if let Some(coordinator) = new_coordinator {
            require_keys_neq!(
                coordinator,
                Pubkey::default(),
                WalletorError::InvalidAddress
            );
            config.coordinator = coordinator;
        }
        if let Some(fee_recipient) = new_fee_recipient {
            require_keys_neq!(
                fee_recipient,
                Pubkey::default(),
                WalletorError::InvalidAddress
            );
            config.fee_recipient = fee_recipient;
        }
        if let Some(next_paused) = paused {
            config.paused = next_paused;
        }

        emit!(ConfigUpdated {
            authority: config.authority,
            coordinator: config.coordinator,
            fee_recipient: config.fee_recipient,
            paused: config.paused,
        });
        Ok(())
    }

    pub fn create_round(ctx: Context<CreateRound>, params: CreateRoundParams) -> Result<()> {
        require!(!ctx.accounts.config.paused, WalletorError::ProgramPaused);
        let clock = Clock::get()?;
        validate_round_params(&params, clock.unix_timestamp)?;

        let round = &mut ctx.accounts.round;
        round.version = 3;
        round.config = ctx.accounts.config.key();
        round.round_id = params.round_id;
        round.status = RoundStatus::Created;
        round.participant_root = params.participant_root;
        round.participant_checksum = params.participant_checksum;
        round.participant_count = params.participant_count;
        round.winner_count = params.winner_count;
        round.total_weight = params.total_weight;
        round.gross_pool_lamports = params.gross_pool_lamports;
        round.claim_fee_bps = CLAIM_FEE_BPS;
        round.fee_recipient = ctx.accounts.config.fee_recipient;
        round.switchboard_program = ctx.accounts.config.switchboard_program;
        round.randomness_account = Pubkey::default();
        round.commit_slot = 0;
        round.randomness = [0; 32];
        round.next_rank = 1;
        round.next_counter = 0;
        round.settled_count = 0;
        round.claimed_count = 0;
        round.claimed_gross_lamports = 0;
        round.claim_deadline_unix_timestamp = params.claim_deadline_unix_timestamp;
        round.recovery_recipient = params.recovery_recipient;
        round.bump = ctx.bumps.round;
        round.vault_bump = ctx.bumps.vault;

        emit!(RoundCreated {
            round: round.key(),
            round_id: round.round_id,
            participant_root: round.participant_root,
            participant_count: round.participant_count,
            winner_count: round.winner_count,
            total_weight: round.total_weight,
            gross_pool_lamports: round.gross_pool_lamports,
            claim_deadline_unix_timestamp: round.claim_deadline_unix_timestamp,
            recovery_recipient: round.recovery_recipient,
        });
        Ok(())
    }

    pub fn fund_round(ctx: Context<FundRound>) -> Result<()> {
        require!(!ctx.accounts.config.paused, WalletorError::ProgramPaused);
        require!(
            ctx.accounts.round.status == RoundStatus::Created,
            WalletorError::InvalidRoundStatus
        );

        let expected = ctx.accounts.round.gross_pool_lamports;
        let current = ctx.accounts.vault.to_account_info().lamports();
        let required = expected.saturating_sub(current);
        if required > 0 {
            let transfer_accounts = anchor_lang::system_program::Transfer {
                from: ctx.accounts.coordinator.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            };
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    transfer_accounts,
                ),
                required,
            )?;
        }
        require!(
            ctx.accounts.vault.to_account_info().lamports() >= expected,
            WalletorError::VaultUnderfunded
        );

        ctx.accounts.round.status = RoundStatus::Funded;
        emit!(RoundFunded {
            round: ctx.accounts.round.key(),
            vault: ctx.accounts.vault.key(),
            gross_pool_lamports: expected,
        });
        Ok(())
    }

    pub fn commit_randomness(ctx: Context<CommitRandomness>) -> Result<()> {
        require!(!ctx.accounts.config.paused, WalletorError::ProgramPaused);
        require!(
            ctx.accounts.round.status == RoundStatus::Funded,
            WalletorError::InvalidRoundStatus
        );
        require_keys_eq!(
            *ctx.accounts.randomness_account.owner,
            ctx.accounts.round.switchboard_program,
            WalletorError::InvalidRandomnessOwner
        );

        let clock = Clock::get()?;
        let data = ctx.accounts.randomness_account.try_borrow_data()?;
        let randomness = RandomnessAccountData::parse(data)
            .map_err(|_| error!(WalletorError::InvalidRandomnessAccount))?;
        let expected_seed_slot = clock
            .slot
            .checked_sub(1)
            .ok_or_else(|| error!(WalletorError::RandomnessExpired))?;
        require!(
            randomness.seed_slot == expected_seed_slot,
            WalletorError::RandomnessExpired
        );
        require!(
            randomness.get_value(clock.slot).is_err(),
            WalletorError::RandomnessAlreadyRevealed
        );

        let round = &mut ctx.accounts.round;
        round.randomness_account = ctx.accounts.randomness_account.key();
        round.commit_slot = randomness.seed_slot;
        round.status = RoundStatus::RandomnessCommitted;

        emit!(RandomnessCommitted {
            round: round.key(),
            randomness_account: round.randomness_account,
            commit_slot: round.commit_slot,
        });
        Ok(())
    }

    pub fn reveal_randomness(ctx: Context<RevealRandomness>) -> Result<()> {
        require!(
            ctx.accounts.round.status == RoundStatus::RandomnessCommitted,
            WalletorError::InvalidRoundStatus
        );
        require_keys_eq!(
            ctx.accounts.randomness_account.key(),
            ctx.accounts.round.randomness_account,
            WalletorError::InvalidRandomnessAccount
        );
        require_keys_eq!(
            *ctx.accounts.randomness_account.owner,
            ctx.accounts.round.switchboard_program,
            WalletorError::InvalidRandomnessOwner
        );

        let clock = Clock::get()?;
        let data = ctx.accounts.randomness_account.try_borrow_data()?;
        let randomness = RandomnessAccountData::parse(data)
            .map_err(|_| error!(WalletorError::InvalidRandomnessAccount))?;
        require!(
            randomness.seed_slot == ctx.accounts.round.commit_slot,
            WalletorError::RandomnessExpired
        );
        let revealed = randomness
            .get_value(clock.slot)
            .map_err(|_| error!(WalletorError::RandomnessNotResolved))?;

        let round = &mut ctx.accounts.round;
        round.randomness = revealed;
        round.status = RoundStatus::RandomnessRevealed;
        emit!(RandomnessRevealed {
            round: round.key(),
            randomness: revealed,
        });
        Ok(())
    }

    pub fn settle_candidate(
        ctx: Context<SettleCandidate>,
        candidate: ParticipantProof,
    ) -> Result<()> {
        require!(
            matches!(
                ctx.accounts.round.status,
                RoundStatus::RandomnessRevealed | RoundStatus::Settling
            ),
            WalletorError::InvalidRoundStatus
        );
        require!(
            ctx.accounts.round.next_rank <= ctx.accounts.round.winner_count,
            WalletorError::AllWinnersSettled
        );

        let rank = ctx.accounts.round.next_rank;
        let counter = ctx.accounts.round.next_counter;
        let ticket = derive_ticket(
            &ctx.accounts.round.randomness,
            &ctx.accounts.round.round_id,
            rank,
            counter,
            ctx.accounts.round.total_weight,
        )?;

        if ticket.is_none() {
            ctx.accounts.round.status = RoundStatus::Settling;
            ctx.accounts.round.next_counter = counter
                .checked_add(1)
                .ok_or_else(|| error!(WalletorError::ArithmeticOverflow))?;
            emit!(CandidateRejected {
                round: ctx.accounts.round.key(),
                rank,
                counter,
                reason: CandidateRejectionReason::Sampling,
            });
            return Ok(());
        }

        let ticket = ticket.ok_or_else(|| error!(WalletorError::InvalidTicket))?;
        verify_participant(
            &ctx.accounts.round,
            &candidate,
            ticket,
            MAX_MERKLE_PROOF_NODES,
        )?;

        let winner = &mut ctx.accounts.winner;
        if winner.round != Pubkey::default() {
            require_keys_eq!(
                winner.round,
                ctx.accounts.round.key(),
                WalletorError::InvalidWinnerAccount
            );
            require_keys_eq!(
                winner.wallet,
                candidate.wallet,
                WalletorError::InvalidWinnerAccount
            );
            ctx.accounts.round.status = RoundStatus::Settling;
            ctx.accounts.round.next_counter = counter
                .checked_add(1)
                .ok_or_else(|| error!(WalletorError::ArithmeticOverflow))?;
            emit!(CandidateRejected {
                round: ctx.accounts.round.key(),
                rank,
                counter,
                reason: CandidateRejectionReason::DuplicateWinner,
            });
            return Ok(());
        }

        let amounts = claim_amounts(
            ctx.accounts.round.gross_pool_lamports,
            ctx.accounts.round.winner_count,
            rank,
            ctx.accounts.round.claim_fee_bps,
        )?;
        winner.round = ctx.accounts.round.key();
        winner.wallet = candidate.wallet;
        winner.rank = rank;
        winner.participant_index = candidate.participant_index;
        winner.winning_ticket = ticket;
        winner.gross_lamports = amounts.gross_lamports;
        winner.claim_fee_lamports = amounts.claim_fee_lamports;
        winner.net_lamports = amounts.net_lamports;
        winner.claimed = false;
        winner.bump = ctx.bumps.winner;

        let round = &mut ctx.accounts.round;
        round.status = RoundStatus::Settling;
        round.settled_count = round
            .settled_count
            .checked_add(1)
            .ok_or_else(|| error!(WalletorError::ArithmeticOverflow))?;
        round.next_rank = round
            .next_rank
            .checked_add(1)
            .ok_or_else(|| error!(WalletorError::ArithmeticOverflow))?;
        round.next_counter = 0;
        if round.settled_count == round.winner_count {
            round.status = RoundStatus::WinnersSettled;
        }

        emit!(WinnerSettled {
            round: round.key(),
            wallet: winner.wallet,
            rank,
            winning_ticket: ticket,
            gross_lamports: winner.gross_lamports,
            claim_fee_lamports: winner.claim_fee_lamports,
            net_lamports: winner.net_lamports,
        });
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        require!(
            matches!(
                ctx.accounts.round.status,
                RoundStatus::Settling | RoundStatus::WinnersSettled
            ),
            WalletorError::InvalidRoundStatus
        );
        require!(!ctx.accounts.winner.claimed, WalletorError::AlreadyClaimed);
        require!(
            Clock::get()?.unix_timestamp <= ctx.accounts.round.claim_deadline_unix_timestamp,
            WalletorError::ClaimWindowExpired
        );
        require_keys_eq!(
            ctx.accounts.winner.wallet,
            ctx.accounts.claimant.key(),
            WalletorError::WrongClaimant
        );
        require_keys_eq!(
            ctx.accounts.fee_recipient.key(),
            ctx.accounts.round.fee_recipient,
            WalletorError::InvalidFeeRecipient
        );

        let required = ctx
            .accounts
            .winner
            .net_lamports
            .checked_add(ctx.accounts.winner.claim_fee_lamports)
            .ok_or_else(|| error!(WalletorError::ArithmeticOverflow))?;
        require!(
            ctx.accounts.vault.to_account_info().lamports() >= required,
            WalletorError::VaultUnderfunded
        );

        ctx.accounts.winner.claimed = true;
        ctx.accounts.round.claimed_count = ctx
            .accounts
            .round
            .claimed_count
            .checked_add(1)
            .ok_or_else(|| error!(WalletorError::ArithmeticOverflow))?;
        ctx.accounts.round.claimed_gross_lamports = ctx
            .accounts
            .round
            .claimed_gross_lamports
            .checked_add(ctx.accounts.winner.gross_lamports)
            .ok_or_else(|| error!(WalletorError::ArithmeticOverflow))?;

        let round_key = ctx.accounts.round.key();
        let vault_bump = [ctx.accounts.round.vault_bump];
        let signer_seeds: &[&[&[u8]]] = &[&[VAULT_SEED, round_key.as_ref(), vault_bump.as_ref()]];

        transfer_from_vault(
            &ctx.accounts.system_program,
            &ctx.accounts.vault,
            &ctx.accounts.claimant.to_account_info(),
            ctx.accounts.winner.net_lamports,
            signer_seeds,
        )?;
        transfer_from_vault(
            &ctx.accounts.system_program,
            &ctx.accounts.vault,
            &ctx.accounts.fee_recipient.to_account_info(),
            ctx.accounts.winner.claim_fee_lamports,
            signer_seeds,
        )?;

        if ctx.accounts.round.claimed_count == ctx.accounts.round.winner_count {
            ctx.accounts.round.status = RoundStatus::Completed;
        }

        emit!(PrizeClaimed {
            round: ctx.accounts.round.key(),
            wallet: ctx.accounts.claimant.key(),
            rank: ctx.accounts.winner.rank,
            gross_lamports: ctx.accounts.winner.gross_lamports,
            claim_fee_lamports: ctx.accounts.winner.claim_fee_lamports,
            net_lamports: ctx.accounts.winner.net_lamports,
        });
        Ok(())
    }

    pub fn recover_expired_round(ctx: Context<RecoverExpiredRound>) -> Result<()> {
        require!(
            matches!(
                ctx.accounts.round.status,
                RoundStatus::Funded
                    | RoundStatus::RandomnessCommitted
                    | RoundStatus::RandomnessRevealed
                    | RoundStatus::Settling
                    | RoundStatus::WinnersSettled
            ),
            WalletorError::InvalidRoundStatus
        );
        require!(
            Clock::get()?.unix_timestamp > ctx.accounts.round.claim_deadline_unix_timestamp,
            WalletorError::ClaimWindowActive
        );

        let recovered_lamports = ctx.accounts.vault.to_account_info().lamports();
        let round_key = ctx.accounts.round.key();
        let vault_bump = [ctx.accounts.round.vault_bump];
        let signer_seeds: &[&[&[u8]]] = &[&[VAULT_SEED, round_key.as_ref(), vault_bump.as_ref()]];

        ctx.accounts.round.status = RoundStatus::Expired;
        transfer_from_vault(
            &ctx.accounts.system_program,
            &ctx.accounts.vault,
            &ctx.accounts.recovery_recipient.to_account_info(),
            recovered_lamports,
            signer_seeds,
        )?;

        emit!(ExpiredRoundRecovered {
            round: ctx.accounts.round.key(),
            recovery_recipient: ctx.accounts.recovery_recipient.key(),
            recovered_lamports,
        });
        Ok(())
    }
}

fn validate_round_params(params: &CreateRoundParams, now_unix_timestamp: i64) -> Result<()> {
    require!(
        params.participant_root != [0; 32],
        WalletorError::InvalidMerkleRoot
    );
    require!(
        params.participant_checksum != [0; 32],
        WalletorError::InvalidParticipantChecksum
    );
    require!(
        params.participant_count > 0 && params.participant_count <= MAX_PARTICIPANTS,
        WalletorError::InvalidParticipantCount
    );
    require!(
        params.winner_count > 0
            && params.winner_count <= MAX_WINNERS
            && u32::from(params.winner_count) <= params.participant_count,
        WalletorError::InvalidWinnerCount
    );
    require!(params.total_weight > 0, WalletorError::InvalidTotalWeight);
    require!(
        params.gross_pool_lamports > 0,
        WalletorError::InvalidPoolAmount
    );
    require_keys_neq!(
        params.recovery_recipient,
        Pubkey::default(),
        WalletorError::InvalidAddress
    );
    let minimum_deadline = now_unix_timestamp
        .checked_add(MIN_CLAIM_WINDOW_SECONDS)
        .ok_or_else(|| error!(WalletorError::ArithmeticOverflow))?;
    let maximum_deadline = now_unix_timestamp
        .checked_add(MAX_CLAIM_WINDOW_SECONDS)
        .ok_or_else(|| error!(WalletorError::ArithmeticOverflow))?;
    require!(
        params.claim_deadline_unix_timestamp >= minimum_deadline
            && params.claim_deadline_unix_timestamp <= maximum_deadline,
        WalletorError::InvalidClaimDeadline
    );
    Ok(())
}

fn expected_weight(eligible_swap_count: u32) -> Result<u64> {
    match eligible_swap_count {
        1..=2 => Ok(10_000),
        3..=4 => Ok(11_000),
        5..=9 => Ok(12_500),
        10.. => Ok(15_000),
        0 => err!(WalletorError::InvalidSwapCount),
    }
}

fn participant_leaf(round_id: &[u8; 32], participant: &ParticipantProof) -> Result<[u8; 32]> {
    let expected = expected_weight(participant.eligible_swap_count)?;
    require!(
        participant.weight == expected,
        WalletorError::InvalidParticipantWeight
    );
    require!(
        participant.range_end > participant.range_start
            && participant.range_end - participant.range_start == participant.weight,
        WalletorError::InvalidParticipantRange
    );

    Ok(hashv(&[
        PARTICIPANT_DOMAIN,
        round_id,
        &participant.participant_index.to_be_bytes(),
        participant.wallet.as_ref(),
        &participant.eligible_swap_count.to_be_bytes(),
        &participant.weight.to_be_bytes(),
        &participant.range_start.to_be_bytes(),
        &participant.range_end.to_be_bytes(),
    ])
    .to_bytes())
}

fn verify_participant(
    round: &Round,
    participant: &ParticipantProof,
    ticket: u64,
    max_proof_nodes: usize,
) -> Result<()> {
    require!(
        participant.participant_index < round.participant_count,
        WalletorError::InvalidParticipantIndex
    );
    require!(
        participant.range_end <= round.total_weight,
        WalletorError::InvalidParticipantRange
    );
    require!(
        ticket >= participant.range_start && ticket < participant.range_end,
        WalletorError::TicketOutsideParticipantRange
    );
    require!(
        participant.merkle_proof.len() <= max_proof_nodes,
        WalletorError::MerkleProofTooLong
    );
    let mut level_width = round.participant_count;
    let mut expected_proof_nodes = 0_usize;
    while level_width > 1 {
        level_width = level_width.div_ceil(2);
        expected_proof_nodes = expected_proof_nodes
            .checked_add(1)
            .ok_or_else(|| error!(WalletorError::ArithmeticOverflow))?;
    }
    require!(
        participant.merkle_proof.len() == expected_proof_nodes,
        WalletorError::InvalidMerkleProofLength
    );

    let mut current = participant_leaf(&round.round_id, participant)?;
    let mut participant_index = participant.participant_index;
    for node in &participant.merkle_proof {
        require!(
            node.sibling_on_left == (participant_index % 2 == 1),
            WalletorError::InvalidMerkleProofPosition
        );
        current = if node.sibling_on_left {
            hashv(&[&node.hash, &current]).to_bytes()
        } else {
            hashv(&[&current, &node.hash]).to_bytes()
        };
        participant_index /= 2;
    }
    require!(
        current == round.participant_root,
        WalletorError::InvalidMerkleProof
    );
    Ok(())
}

fn derive_candidate(randomness: &[u8; 32], round_id: &[u8; 32], rank: u16, counter: u32) -> u128 {
    let digest = hashv(&[
        DRAW_DOMAIN,
        randomness,
        round_id,
        &rank.to_be_bytes(),
        &counter.to_be_bytes(),
    ])
    .to_bytes();
    let mut first_half = [0_u8; 16];
    first_half.copy_from_slice(&digest[..16]);
    u128::from_be_bytes(first_half)
}

fn derive_ticket(
    randomness: &[u8; 32],
    round_id: &[u8; 32],
    rank: u16,
    counter: u32,
    total_weight: u64,
) -> Result<Option<u64>> {
    require!(total_weight > 0, WalletorError::InvalidTotalWeight);
    let candidate = derive_candidate(randomness, round_id, rank, counter);
    let weight = u128::from(total_weight);
    let limit = u128::MAX - (u128::MAX % weight);
    if candidate >= limit {
        return Ok(None);
    }
    let ticket = candidate % weight;
    Ok(Some(
        u64::try_from(ticket).map_err(|_| error!(WalletorError::ArithmeticOverflow))?,
    ))
}

fn claim_amounts(
    gross_pool_lamports: u64,
    winner_count: u16,
    rank: u16,
    claim_fee_bps: u16,
) -> Result<ClaimAmounts> {
    require!(winner_count > 0, WalletorError::InvalidWinnerCount);
    require!(
        rank > 0 && rank <= winner_count,
        WalletorError::InvalidWinnerRank
    );
    require!(
        claim_fee_bps == CLAIM_FEE_BPS,
        WalletorError::InvalidClaimFee
    );

    let divisor = u64::from(winner_count);
    let base = gross_pool_lamports / divisor;
    let remainder = gross_pool_lamports % divisor;
    let remainder_bonus = if u64::from(rank) <= remainder { 1 } else { 0 };
    let gross_lamports = base
        .checked_add(remainder_bonus)
        .ok_or_else(|| error!(WalletorError::ArithmeticOverflow))?;
    let claim_fee_lamports = u64::try_from(
        u128::from(gross_lamports) * u128::from(claim_fee_bps) / BASIS_POINTS_DENOMINATOR,
    )
    .map_err(|_| error!(WalletorError::ArithmeticOverflow))?;
    let net_lamports = gross_lamports
        .checked_sub(claim_fee_lamports)
        .ok_or_else(|| error!(WalletorError::ArithmeticOverflow))?;
    Ok(ClaimAmounts {
        gross_lamports,
        claim_fee_lamports,
        net_lamports,
    })
}

fn transfer_from_vault<'info>(
    system_program: &Program<'info, System>,
    vault: &SystemAccount<'info>,
    recipient: &AccountInfo<'info>,
    lamports: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    if lamports == 0 {
        return Ok(());
    }
    let transfer_accounts = anchor_lang::system_program::Transfer {
        from: vault.to_account_info(),
        to: recipient.clone(),
    };
    anchor_lang::system_program::transfer(
        CpiContext::new_with_signer(
            system_program.to_account_info(),
            transfer_accounts,
            signer_seeds,
        ),
        lamports,
    )
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ WalletorError::Unauthorized
    )]
    pub config: Account<'info, Config>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(params: CreateRoundParams)]
pub struct CreateRound<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = coordinator @ WalletorError::Unauthorized
    )]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = coordinator,
        space = 8 + Round::INIT_SPACE,
        seeds = [ROUND_SEED, params.round_id.as_ref()],
        bump
    )]
    pub round: Account<'info, Round>,
    /// A zero-data, System Program-owned PDA. It receives SOL when the round is funded.
    #[account(seeds = [VAULT_SEED, round.key().as_ref()], bump)]
    pub vault: SystemAccount<'info>,
    #[account(mut)]
    pub coordinator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundRound<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = coordinator @ WalletorError::Unauthorized
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [ROUND_SEED, round.round_id.as_ref()],
        bump = round.bump,
        has_one = config
    )]
    pub round: Account<'info, Round>,
    #[account(
        mut,
        seeds = [VAULT_SEED, round.key().as_ref()],
        bump = round.vault_bump
    )]
    pub vault: SystemAccount<'info>,
    #[account(mut)]
    pub coordinator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CommitRandomness<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = coordinator @ WalletorError::Unauthorized
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [ROUND_SEED, round.round_id.as_ref()],
        bump = round.bump,
        has_one = config
    )]
    pub round: Account<'info, Round>,
    pub coordinator: Signer<'info>,
    /// CHECK: The handler validates the owner, Switchboard layout, freshness, and reveal state.
    pub randomness_account: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RevealRandomness<'info> {
    #[account(
        mut,
        seeds = [ROUND_SEED, round.round_id.as_ref()],
        bump = round.bump
    )]
    pub round: Account<'info, Round>,
    /// CHECK: The handler validates the stored address, owner, layout, seed slot, and value.
    pub randomness_account: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(candidate: ParticipantProof)]
pub struct SettleCandidate<'info> {
    #[account(
        mut,
        seeds = [ROUND_SEED, round.round_id.as_ref()],
        bump = round.bump
    )]
    pub round: Account<'info, Round>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Winner::INIT_SPACE,
        seeds = [WINNER_SEED, round.key().as_ref(), candidate.wallet.as_ref()],
        bump
    )]
    pub winner: Account<'info, Winner>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(
        mut,
        seeds = [ROUND_SEED, round.round_id.as_ref()],
        bump = round.bump
    )]
    pub round: Account<'info, Round>,
    #[account(
        mut,
        seeds = [VAULT_SEED, round.key().as_ref()],
        bump = round.vault_bump
    )]
    pub vault: SystemAccount<'info>,
    #[account(
        mut,
        seeds = [WINNER_SEED, round.key().as_ref(), claimant.key().as_ref()],
        bump = winner.bump,
        constraint = winner.round == round.key() @ WalletorError::InvalidWinnerAccount
    )]
    pub winner: Account<'info, Winner>,
    #[account(mut)]
    pub claimant: Signer<'info>,
    #[account(mut, address = round.fee_recipient @ WalletorError::InvalidFeeRecipient)]
    pub fee_recipient: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecoverExpiredRound<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ WalletorError::Unauthorized
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [ROUND_SEED, round.round_id.as_ref()],
        bump = round.bump,
        has_one = config,
        has_one = recovery_recipient @ WalletorError::InvalidRecoveryRecipient
    )]
    pub round: Account<'info, Round>,
    #[account(
        mut,
        seeds = [VAULT_SEED, round.key().as_ref()],
        bump = round.vault_bump
    )]
    pub vault: SystemAccount<'info>,
    pub authority: Signer<'info>,
    #[account(mut)]
    pub recovery_recipient: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub version: u8,
    pub authority: Pubkey,
    pub coordinator: Pubkey,
    pub fee_recipient: Pubkey,
    pub switchboard_program: Pubkey,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Round {
    pub version: u8,
    pub config: Pubkey,
    pub round_id: [u8; 32],
    pub status: RoundStatus,
    pub participant_root: [u8; 32],
    pub participant_checksum: [u8; 32],
    pub participant_count: u32,
    pub winner_count: u16,
    pub total_weight: u64,
    pub gross_pool_lamports: u64,
    pub claim_fee_bps: u16,
    pub fee_recipient: Pubkey,
    pub switchboard_program: Pubkey,
    pub randomness_account: Pubkey,
    pub commit_slot: u64,
    pub randomness: [u8; 32],
    pub next_rank: u16,
    pub next_counter: u32,
    pub settled_count: u16,
    pub claimed_count: u16,
    pub claimed_gross_lamports: u64,
    pub bump: u8,
    pub vault_bump: u8,
    pub claim_deadline_unix_timestamp: i64,
    pub recovery_recipient: Pubkey,
}

#[account]
#[derive(InitSpace)]
pub struct Winner {
    pub round: Pubkey,
    pub wallet: Pubkey,
    pub rank: u16,
    pub participant_index: u32,
    pub winning_ticket: u64,
    pub gross_lamports: u64,
    pub claim_fee_lamports: u64,
    pub net_lamports: u64,
    pub claimed: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateRoundParams {
    pub round_id: [u8; 32],
    pub participant_root: [u8; 32],
    pub participant_checksum: [u8; 32],
    pub participant_count: u32,
    pub winner_count: u16,
    pub total_weight: u64,
    pub gross_pool_lamports: u64,
    pub claim_deadline_unix_timestamp: i64,
    pub recovery_recipient: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ParticipantProof {
    pub participant_index: u32,
    pub wallet: Pubkey,
    pub eligible_swap_count: u32,
    pub weight: u64,
    pub range_start: u64,
    pub range_end: u64,
    pub merkle_proof: Vec<MerkleProofNode>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MerkleProofNode {
    pub sibling_on_left: bool,
    pub hash: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq)]
pub enum RoundStatus {
    Created,
    Funded,
    RandomnessCommitted,
    RandomnessRevealed,
    Settling,
    WinnersSettled,
    Completed,
    Expired,
}

struct ClaimAmounts {
    gross_lamports: u64,
    claim_fee_lamports: u64,
    net_lamports: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub enum CandidateRejectionReason {
    Sampling,
    DuplicateWinner,
}

#[event]
pub struct ConfigInitialized {
    pub authority: Pubkey,
    pub coordinator: Pubkey,
    pub fee_recipient: Pubkey,
    pub switchboard_program: Pubkey,
}

#[event]
pub struct ConfigUpdated {
    pub authority: Pubkey,
    pub coordinator: Pubkey,
    pub fee_recipient: Pubkey,
    pub paused: bool,
}

#[event]
pub struct RoundCreated {
    pub round: Pubkey,
    pub round_id: [u8; 32],
    pub participant_root: [u8; 32],
    pub participant_count: u32,
    pub winner_count: u16,
    pub total_weight: u64,
    pub gross_pool_lamports: u64,
    pub claim_deadline_unix_timestamp: i64,
    pub recovery_recipient: Pubkey,
}

#[event]
pub struct RoundFunded {
    pub round: Pubkey,
    pub vault: Pubkey,
    pub gross_pool_lamports: u64,
}

#[event]
pub struct RandomnessCommitted {
    pub round: Pubkey,
    pub randomness_account: Pubkey,
    pub commit_slot: u64,
}

#[event]
pub struct RandomnessRevealed {
    pub round: Pubkey,
    pub randomness: [u8; 32],
}

#[event]
pub struct CandidateRejected {
    pub round: Pubkey,
    pub rank: u16,
    pub counter: u32,
    pub reason: CandidateRejectionReason,
}

#[event]
pub struct WinnerSettled {
    pub round: Pubkey,
    pub wallet: Pubkey,
    pub rank: u16,
    pub winning_ticket: u64,
    pub gross_lamports: u64,
    pub claim_fee_lamports: u64,
    pub net_lamports: u64,
}

#[event]
pub struct PrizeClaimed {
    pub round: Pubkey,
    pub wallet: Pubkey,
    pub rank: u16,
    pub gross_lamports: u64,
    pub claim_fee_lamports: u64,
    pub net_lamports: u64,
}

#[event]
pub struct ExpiredRoundRecovered {
    pub round: Pubkey,
    pub recovery_recipient: Pubkey,
    pub recovered_lamports: u64,
}

#[error_code]
pub enum WalletorError {
    #[msg("The signer is not authorized for this action.")]
    Unauthorized,
    #[msg("The supplied address is invalid.")]
    InvalidAddress,
    #[msg("New rounds and commitments are paused.")]
    ProgramPaused,
    #[msg("The round is not in the required state.")]
    InvalidRoundStatus,
    #[msg("The participant Merkle root is invalid.")]
    InvalidMerkleRoot,
    #[msg("The participant checksum is invalid.")]
    InvalidParticipantChecksum,
    #[msg("The participant count is invalid.")]
    InvalidParticipantCount,
    #[msg("The winner count is invalid.")]
    InvalidWinnerCount,
    #[msg("The winner rank is invalid.")]
    InvalidWinnerRank,
    #[msg("The total participant weight is invalid.")]
    InvalidTotalWeight,
    #[msg("The Prize Pool amount is invalid.")]
    InvalidPoolAmount,
    #[msg("The claim deadline is outside Walletor's allowed claim window.")]
    InvalidClaimDeadline,
    #[msg("The claim window has expired.")]
    ClaimWindowExpired,
    #[msg("The claim window is still active.")]
    ClaimWindowActive,
    #[msg("The expired-round recovery recipient is invalid.")]
    InvalidRecoveryRecipient,
    #[msg("The round vault does not contain enough SOL.")]
    VaultUnderfunded,
    #[msg("The Switchboard randomness account has the wrong owner.")]
    InvalidRandomnessOwner,
    #[msg("The Switchboard randomness account is invalid.")]
    InvalidRandomnessAccount,
    #[msg("The Switchboard commitment is stale.")]
    RandomnessExpired,
    #[msg("The randomness value was revealed before Walletor committed the round.")]
    RandomnessAlreadyRevealed,
    #[msg("Switchboard has not resolved the committed randomness value.")]
    RandomnessNotResolved,
    #[msg("Every winner for this round is already settled.")]
    AllWinnersSettled,
    #[msg("The participant index is invalid.")]
    InvalidParticipantIndex,
    #[msg("The participant swap count is invalid.")]
    InvalidSwapCount,
    #[msg("The participant weight does not match the published tier.")]
    InvalidParticipantWeight,
    #[msg("The participant weight interval is invalid.")]
    InvalidParticipantRange,
    #[msg("The derived ticket is outside the supplied participant interval.")]
    TicketOutsideParticipantRange,
    #[msg("The participant Merkle proof is too long.")]
    MerkleProofTooLong,
    #[msg("The participant Merkle proof has the wrong number of levels.")]
    InvalidMerkleProofLength,
    #[msg("A participant Merkle proof node is on the wrong side for its index.")]
    InvalidMerkleProofPosition,
    #[msg("The participant Merkle proof does not match the locked root.")]
    InvalidMerkleProof,
    #[msg("The derived ticket is invalid.")]
    InvalidTicket,
    #[msg("The winner account is invalid.")]
    InvalidWinnerAccount,
    #[msg("This prize has already been claimed.")]
    AlreadyClaimed,
    #[msg("Only the winning wallet can claim this prize.")]
    WrongClaimant,
    #[msg("The claim fee recipient is invalid.")]
    InvalidFeeRecipient,
    #[msg("The claim fee does not match Walletor's fixed 50 bps policy.")]
    InvalidClaimFee,
    #[msg("An integer calculation overflowed.")]
    ArithmeticOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_participant() -> ParticipantProof {
        ParticipantProof {
            participant_index: 0,
            wallet: Pubkey::new_from_array([7; 32]),
            eligible_swap_count: 3,
            weight: 11_000,
            range_start: 0,
            range_end: 11_000,
            merkle_proof: Vec::new(),
        }
    }

    #[test]
    fn claim_split_preserves_the_pool_and_fee_policy() {
        let pool = 1_000_019_u64;
        let claims = (1..=20)
            .map(|rank| claim_amounts(pool, 20, rank, 50).expect("claim amount"))
            .collect::<Vec<_>>();
        assert_eq!(
            claims.iter().map(|claim| claim.gross_lamports).sum::<u64>(),
            pool
        );
        assert_eq!(claims[0].gross_lamports, 50_001);
        assert_eq!(claims[0].claim_fee_lamports, 250);
        assert_eq!(claims[0].net_lamports, 49_751);
        assert_eq!(claims[19].gross_lamports, 50_000);
    }

    #[test]
    fn participant_leaf_is_stable_and_tier_checked() {
        let round_id: [u8; 32] =
            hex::decode("2f3617f018b0ef29a7bc5db8c2d6b33dda0130cb33b6cf6418c73201e8b94d68")
                .expect("round id")
                .try_into()
                .expect("32-byte round id");
        let participant = sample_participant();
        let first = participant_leaf(&round_id, &participant).expect("leaf");
        let second = participant_leaf(&round_id, &participant).expect("leaf");
        assert_eq!(first, second);
        assert_eq!(
            hex::encode(first),
            "802461597b96d0da66fc380ca4740dc8d7d8d2ff0ccbbcd0c9fbeffad00f2eb8"
        );

        let mut invalid = participant;
        invalid.weight = 15_000;
        assert!(participant_leaf(&round_id, &invalid).is_err());
    }

    #[test]
    fn ticket_derivation_is_stable_and_bounded() {
        let randomness = [0xab; 32];
        let round_id: [u8; 32] =
            hex::decode("2f3617f018b0ef29a7bc5db8c2d6b33dda0130cb33b6cf6418c73201e8b94d68")
                .expect("round id")
                .try_into()
                .expect("32-byte round id");
        let first = derive_ticket(&randomness, &round_id, 1, 0, 11_000)
            .expect("ticket")
            .expect("accepted sample");
        let repeated = derive_ticket(&randomness, &round_id, 1, 0, 11_000)
            .expect("ticket")
            .expect("accepted sample");
        assert_eq!(first, repeated);
        assert_eq!(first, 5_674);
    }

    #[test]
    fn merkle_proof_accepts_the_committed_leaf() {
        let round_id = [3_u8; 32];
        let participant = sample_participant();
        let root = participant_leaf(&round_id, &participant).expect("root");
        let round = Round {
            version: 2,
            config: Pubkey::new_unique(),
            round_id,
            status: RoundStatus::RandomnessRevealed,
            participant_root: root,
            participant_checksum: [4; 32],
            participant_count: 1,
            winner_count: 1,
            total_weight: 11_000,
            gross_pool_lamports: 1_000_000,
            claim_fee_bps: 50,
            fee_recipient: Pubkey::new_unique(),
            switchboard_program: Pubkey::new_unique(),
            randomness_account: Pubkey::new_unique(),
            commit_slot: 1,
            randomness: [0xab; 32],
            next_rank: 1,
            next_counter: 0,
            settled_count: 0,
            claimed_count: 0,
            claimed_gross_lamports: 0,
            claim_deadline_unix_timestamp: 1_900_000_000,
            recovery_recipient: Pubkey::new_unique(),
            bump: 1,
            vault_bump: 1,
        };
        verify_participant(&round, &participant, 5_000, MAX_MERKLE_PROOF_NODES)
            .expect("valid proof");
    }

    #[test]
    fn merkle_proof_binds_the_leaf_to_its_published_index() {
        let round_id = [9_u8; 32];
        let left = sample_participant();
        let mut right = ParticipantProof {
            participant_index: 1,
            wallet: Pubkey::new_from_array([8; 32]),
            eligible_swap_count: 1,
            weight: 10_000,
            range_start: 11_000,
            range_end: 21_000,
            merkle_proof: Vec::new(),
        };
        let left_hash = participant_leaf(&round_id, &left).expect("left leaf");
        let right_hash = participant_leaf(&round_id, &right).expect("right leaf");
        let root = hashv(&[&left_hash, &right_hash]).to_bytes();
        right.merkle_proof.push(MerkleProofNode {
            sibling_on_left: true,
            hash: left_hash,
        });
        let round = Round {
            version: 2,
            config: Pubkey::new_unique(),
            round_id,
            status: RoundStatus::RandomnessRevealed,
            participant_root: root,
            participant_checksum: [4; 32],
            participant_count: 2,
            winner_count: 2,
            total_weight: 21_000,
            gross_pool_lamports: 1_000_000,
            claim_fee_bps: 50,
            fee_recipient: Pubkey::new_unique(),
            switchboard_program: Pubkey::new_unique(),
            randomness_account: Pubkey::new_unique(),
            commit_slot: 1,
            randomness: [0xab; 32],
            next_rank: 1,
            next_counter: 0,
            settled_count: 0,
            claimed_count: 0,
            claimed_gross_lamports: 0,
            claim_deadline_unix_timestamp: 1_900_000_000,
            recovery_recipient: Pubkey::new_unique(),
            bump: 1,
            vault_bump: 1,
        };

        verify_participant(&round, &right, 15_000, MAX_MERKLE_PROOF_NODES)
            .expect("valid indexed proof");
        right.merkle_proof[0].sibling_on_left = false;
        assert!(verify_participant(&round, &right, 15_000, MAX_MERKLE_PROOF_NODES).is_err());
    }

    #[test]
    fn round_params_require_a_bounded_claim_window_and_recovery_wallet() {
        let now = 1_800_000_000;
        let mut params = CreateRoundParams {
            round_id: [1; 32],
            participant_root: [2; 32],
            participant_checksum: [3; 32],
            participant_count: 1,
            winner_count: 1,
            total_weight: 10_000,
            gross_pool_lamports: 1_000,
            claim_deadline_unix_timestamp: now + 30 * 24 * 60 * 60,
            recovery_recipient: Pubkey::new_unique(),
        };
        validate_round_params(&params, now).expect("valid claim window");

        params.claim_deadline_unix_timestamp = now + MIN_CLAIM_WINDOW_SECONDS - 1;
        assert!(validate_round_params(&params, now).is_err());
        params.claim_deadline_unix_timestamp = now + 30 * 24 * 60 * 60;
        params.recovery_recipient = Pubkey::default();
        assert!(validate_round_params(&params, now).is_err());
    }
}

use super::ensemble::Context;
use crate::cosmwasm_std::{
    Querier, QueryRequest, WasmQuery, BankQuery, StakingQuery, QuerierResult, SystemResult,
    SystemError, ContractResult, Empty, AllBalanceResponse, BalanceResponse, ValidatorResponse,
    AllValidatorsResponse, AllDelegationsResponse, BondedDenomResponse, from_slice, to_binary,
    testing::MockQuerier
};

pub struct EnsembleQuerier {
    // NOTE: raw pointer to crate::ensemble::ContractEnsemble::ctx
    ctx: *const Context,
    base: MockQuerier,
}

impl EnsembleQuerier {
    pub(crate) fn new(ctx: &Context) -> Self {
        Self {
            ctx,
            base: MockQuerier::new(&[]),
        }
    }
}

macro_rules! querier_result {
    ($x:expr) => {
        {
            let result = match $x {
                Ok(bin) => ContractResult::Ok(bin),
                Err(err) => ContractResult::Err(err.to_string())
            };
        
            SystemResult::Ok(result)
        }
    };
}

impl Querier for EnsembleQuerier {
    fn raw_query(&self, bin_request: &[u8]) -> QuerierResult {
        let request: QueryRequest<Empty> = match from_slice(bin_request) {
            Ok(v) => v,
            Err(e) => {
                return SystemResult::Err(SystemError::InvalidRequest {
                    error: format!("Parsing query request: {}", e),
                    request: bin_request.into(),
                })
            }
        };

        let ctx = unsafe { &*(self.ctx) };

        match request {
            QueryRequest::Wasm(query) => match query {
                WasmQuery::Smart {
                    contract_addr, msg, ..
                } => {
                    if !ctx.instances.contains_key(&contract_addr) {
                        return SystemResult::Err(SystemError::NoSuchContract {
                            addr: contract_addr
                        });
                    }

                    querier_result!(ctx.query(&contract_addr, msg))
                }
                WasmQuery::Raw { contract_addr, .. } => {
                    if !ctx.instances.contains_key(&contract_addr) {
                        return SystemResult::Err(SystemError::NoSuchContract {
                            addr: contract_addr
                        });
                    }

                    todo!()
                }
                _ => unimplemented!(),
            },
            QueryRequest::Bank(query) => match query {
                BankQuery::AllBalances { address } => {
                    let amount = ctx.bank.readable().query_balances(&address, None);

                    querier_result!(to_binary(&AllBalanceResponse { amount }))
                }
                BankQuery::Balance { address, denom } => {
                    let amount = ctx.bank.readable().query_balances(&address, Some(denom));

                    querier_result!(to_binary(&BalanceResponse {
                        amount: amount.into_iter().next().unwrap()
                    }))
                }
                _ => unimplemented!(),
            },
            QueryRequest::Staking(query) => match query {
                StakingQuery::AllDelegations { delegator } => {
                    let delegations = ctx.delegations.all_delegations(&delegator);

                    querier_result!(to_binary(&AllDelegationsResponse { delegations }))
                }
                StakingQuery::BondedDenom {} => {
                    let denom = ctx.delegations.bonded_denom();

                    querier_result!(to_binary(&BondedDenomResponse {
                        denom: denom.to_string(),
                    }))
                }
                StakingQuery::Delegation {
                    delegator,
                    validator
                } => {
                    let delegation = ctx.delegations.delegation(&delegator, &validator);

                    querier_result!(to_binary(&delegation))
                }
                StakingQuery::AllValidators {} => {
                    let validators = ctx.delegations.validators();

                    querier_result!(to_binary(&AllValidatorsResponse {
                        validators: validators.to_vec(),
                    }))
                }
                StakingQuery::Validator { address } => {
                    let validator = ctx
                        .delegations
                        .validators()
                        .iter()
                        .filter(|validator| validator.address == address)
                        .next()
                        .cloned();

                    querier_result!(to_binary(&ValidatorResponse { validator }))
                }
                _ => unimplemented!(),
            },
            _ => self.base.handle_query(&request)
        }
    }
}

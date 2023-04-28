#[fadroma::dsl::contract]
pub mod contract {
    use fadroma::{
        schemars,
        cosmwasm_std::{self, Response, StdError},
        dsl::*,
        storage::{ItemSpace, TypedKey}
    };

    /** Some data, e.g. a string. */
    type Data = String;
    fadroma::namespace!(DataNs, b"data");
    const DATA: ItemSpace::<Data, DataNs, TypedKey<String>> = ItemSpace::new();

    /** Some metadata, e.g. a timestamp. */
    type Meta = u64;
    fadroma::namespace!(TimeNs, b"meta");
    const META: ItemSpace::<Meta, TimeNs, TypedKey<String>> = ItemSpace::new();

    impl Contract {
        #[init(entry)]
        pub fn new () -> Result<Response, StdError> {
            Ok(Response::default())
        }
    
        #[query]
        pub fn get (key: String) -> Result<(Option<Data>, Option<Meta>), StdError> {
            Ok((DATA.load(deps.storage, &key)?, META.load(deps.storage, &key)?))
        }
    
        #[execute]
        pub fn set (key: String, value: String) -> Result<Response, StdError> {
            DATA.save(deps.storage, &key, &value)?;
            META.save(deps.storage, &key, &env.block.time.nanos())?;
            Ok(Response::default())
        }
    
        #[execute]
        pub fn del (key: String) -> Result<Response, StdError> {
            DATA.remove(deps.storage, &key);
            META.save(deps.storage, &key, &env.block.time.nanos())?;
            Ok(Response::default())
        }
    }
}

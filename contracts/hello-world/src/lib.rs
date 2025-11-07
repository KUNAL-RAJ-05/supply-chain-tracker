#![allow(non_snake_case)]
#![no_std]
use soroban_sdk::{contract, contracttype, contractimpl, log, Env, Symbol, String, symbol_short};

// Structure to track product information
#[contracttype]
#[derive(Clone)]
pub struct Product {
    pub product_id: u64,
    pub name: String,
    pub manufacturer: String,
    pub timestamp: u64,
    pub current_location: String,
    pub status: String, // "manufactured", "in_transit", "delivered"
}

// For creating unique product IDs
const PRODUCT_COUNT: Symbol = symbol_short!("P_COUNT");

// Mapping product ID to Product struct
#[contracttype]
pub enum ProductBook {
    Product(u64)
}

#[contract]
pub struct SupplyChainContract;

#[contractimpl]
impl SupplyChainContract {
    
    // Function 1: Register a new product in the supply chain
    pub fn register_product(
        env: Env, 
        name: String, 
        manufacturer: String, 
        location: String
    ) -> u64 {
        // Get and increment product count
        let mut product_count: u64 = env.storage().instance().get(&PRODUCT_COUNT).unwrap_or(0);
        product_count += 1;
        
        // Get current timestamp
        let timestamp = env.ledger().timestamp();
        
        // Create new product
        let product = Product {
            product_id: product_count,
            name,
            manufacturer,
            timestamp,
            current_location: location,
            status: String::from_str(&env, "manufactured"),
        };
        
        // Store product in blockchain
        env.storage().instance().set(&ProductBook::Product(product_count), &product);
        env.storage().instance().set(&PRODUCT_COUNT, &product_count);
        
        env.storage().instance().extend_ttl(5000, 5000);
        
        log!(&env, "Product registered with ID: {}", product_count);
        product_count
    }
    
    // Function 2: Update product location and status
    pub fn update_product_status(
        env: Env, 
        product_id: u64, 
        new_location: String, 
        new_status: String
    ) {
        let mut product = Self::get_product(env.clone(), product_id);
        
        // Check if product exists
        if product.product_id == 0 {
            log!(&env, "Product not found!");
            panic!("Product not found!");
        }
        
        // Update product details
        product.current_location = new_location;
        product.status = new_status;
        product.timestamp = env.ledger().timestamp();
        
        // Store updated product
        env.storage().instance().set(&ProductBook::Product(product_id), &product);
        env.storage().instance().extend_ttl(5000, 5000);
        
        log!(&env, "Product ID: {} updated successfully", product_id);
    }
    
    // Function 3: Get product details by ID
    pub fn get_product(env: Env, product_id: u64) -> Product {
        let key = ProductBook::Product(product_id);
        
        env.storage().instance().get(&key).unwrap_or(Product {
            product_id: 0,
            name: String::from_str(&env, "Not_Found"),
            manufacturer: String::from_str(&env, "Not_Found"),
            timestamp: 0,
            current_location: String::from_str(&env, "Not_Found"),
            status: String::from_str(&env, "Not_Found"),
        })
    }
    
    // Function 4: Get total number of registered products
    pub fn get_total_products(env: Env) -> u64 {
        env.storage().instance().get(&PRODUCT_COUNT).unwrap_or(0)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn test_register_product() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SupplyChainContract);
        let client = SupplyChainContractClient::new(&env, &contract_id);

        let name = String::from_str(&env, "Laptop");
        let manufacturer = String::from_str(&env, "TechCorp");
        let location = String::from_str(&env, "Factory A");

        let product_id = client.register_product(&name, &manufacturer, &location);
        assert_eq!(product_id, 1);
    }
}
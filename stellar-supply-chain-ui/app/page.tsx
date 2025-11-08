"use client";
import { useState, ChangeEvent, useEffect } from "react";
import * as freighter from "@stellar/freighter-api";
import {
  TransactionBuilder,
  SorobanRpc,
  Networks,
  Account,
  Contract,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";

// --- Your Contract and Network Details ---
const CONTRACT_ID = "CBX6DIAW47UHW7CLUOH2OK3JO326NFFNMLFXOTLGOEMWISALNIXMCFG7"; // Replace with your deployed contract ID
const TESTNET_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;

// Helper to create a new RPC server
const sorobanServer = new SorobanRpc.Server(TESTNET_URL, {
  allowHttp: true,
});

// Helper to convert Soroban's complex xdr.ScVal to a readable JavaScript object
const scValToObject = (scVal: xdr.ScVal): any => {
  if (!scVal) return null;
  switch (scVal.switch().value) {
    case xdr.ScValType.scvBool().value:
      return scVal.b();
    case xdr.ScValType.scvString().value:
      return scVal.str().toString();
    case xdr.ScValType.scvU64().value:
    case xdr.ScValType.scvI64().value:
      return scVal.u64?.().toString() || scVal.i64?.().toString();
    case xdr.ScValType.scvSymbol().value:
      return scVal.sym().toString();
    case xdr.ScValType.scvVec().value:
      return scVal.vec()?.map(scValToObject);
    case xdr.ScValType.scvMap().value:
      const map: any = {};
      scVal.map()?.forEach((entry) => {
        const key = scValToObject(entry.key());
        map[key] = scValToObject(entry.val());
      });
      return map;
    default:
      return "Unsupported ScVal Type";
  }
};

export default function Home() {
  // --- React State Hooks ---
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [totalProducts, setTotalProducts] = useState<string>("0");
  const [lastProductId, setLastProductId] = useState<string | null>(null);
  const [retrievedProduct, setRetrievedProduct] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form state for registering a product
  const [registerForm, setRegisterForm] = useState({
    name: "",
    manufacturer: "",
    location: "",
  });

  // Form state for updating a product
  const [updateForm, setUpdateForm] = useState({
    id: "",
    status: "in_transit",
    location: "",
  });

  // Form state for retrieving a product
  const [retrieveId, setRetrieveId] = useState("");

  // --- Wallet Connection ---
  const connectWallet = async () => {
    try {
      if (await freighter.isAllowed()) {
        const key = await freighter.getPublicKey();
        setPublicKey(key);
      } else {
        await freighter.setAllowed();
        const key = await freighter.getPublicKey();
        setPublicKey(key);
      }
    } catch (e: any) {
      console.error(e);
      setError("Error connecting wallet. Make sure Freighter is installed.");
    }
  };

  // --- Helper: Get Source Account ---
  const getSourceAccount = async (): Promise<Account> => {
    if (!publicKey) throw new Error("Wallet not connected.");
    return await sorobanServer.getAccount(publicKey);
  };

  // --- Read-Only Call: Get Total Products ---
  const fetchTotalProducts = async () => {
    if (!publicKey) return;
    console.log("Fetching total products...");
    try {
      const sourceAccount = await getSourceAccount();
      const contract = new Contract(CONTRACT_ID);

      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(contract.call("get_total_products"))
        .setTimeout(30)
        .build();

      const simulation = await sorobanServer.simulateTransaction(tx);

      if (SorobanRpc.Api.isSimulationSuccess(simulation)) {
        const total = scValToObject(simulation.result!.retval);
        setTotalProducts(total);
      } else {
        console.error("Error simulating get_total_products:", simulation);
        setError("Could not fetch total products.");
      }
    } catch (error: any) {
      console.error(error);
      setError("Error fetching total products.");
    }
  };

  // --- useEffect to fetch total on wallet connect ---
  useEffect(() => {
    if (publicKey) {
      fetchTotalProducts();
    }
  }, [publicKey]);

  // --- Form Input Handlers ---
  const handleRegisterChange = (e: ChangeEvent<HTMLInputElement>) => {
    setRegisterForm({ ...registerForm, [e.target.name]: e.target.value });
  };

  const handleUpdateChange = (
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    setUpdateForm({ ...updateForm, [e.target.name]: e.target.value });
  };

  // --- Helper: Generic Signed Transaction ---
  const submitSignedTransaction = async (
    tx: any,
    operationName: string
  ): Promise<SorobanRpc.Api.GetTransactionResponse> => {
    setIsLoading(true);
    setError(null);
    try {
      const preparedTx = await sorobanServer.prepareTransaction(tx);

      const signedXDR = await freighter.signTransaction(preparedTx.toXDR(), {
        network: "TESTNET",
        networkPassphrase: NETWORK_PASSPHRASE,
      });

      const signedTx = TransactionBuilder.fromXDR(signedXDR, NETWORK_PASSPHRASE);

      const sendResult = await sorobanServer.sendTransaction(signedTx);

      let getResult = await sorobanServer.getTransaction(sendResult.hash);
      while (getResult.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        getResult = await sorobanServer.getTransaction(sendResult.hash);
      }

      if (getResult.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
        return getResult;
      } else {
        throw new Error(
          `Transaction failed for ${operationName}. Status: ${getResult.status}`
        );
      }
    } catch (error: any) {
      console.error(error);
      setError(error.message || "Transaction failed");
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  // --- Feature 1: Register Product ---
  const handleRegisterProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicKey) {
      alert("Please connect your wallet first.");
      return;
    }

    try {
      const sourceAccount = await getSourceAccount();
      const contract = new Contract(CONTRACT_ID);

      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100000",
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          contract.call(
            "register_product",
            nativeToScVal(registerForm.name, { type: "string" }),
            nativeToScVal(registerForm.manufacturer, { type: "string" }),
            nativeToScVal(registerForm.location, { type: "string" })
          )
        )
        .setTimeout(30)
        .build();

      const getResult = await submitSignedTransaction(tx, "Register Product");

      const returnedId = scValToObject(getResult.returnValue!);
      setLastProductId(returnedId);
      alert(`✅ Product registered! ID: ${returnedId}`);
      setRegisterForm({ name: "", manufacturer: "", location: "" });
      fetchTotalProducts();
    } catch (error) {
      console.error(error);
    }
  };

  // --- Feature 2: Update Product Status ---
  const handleUpdateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicKey) {
      alert("Please connect your wallet first.");
      return;
    }
    try {
      const sourceAccount = await getSourceAccount();
      const contract = new Contract(CONTRACT_ID);

      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100000",
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          contract.call(
            "update_product_status",
            nativeToScVal(parseInt(updateForm.id), { type: "u64" }),
            nativeToScVal(updateForm.location, { type: "string" }),
            nativeToScVal(updateForm.status, { type: "string" })
          )
        )
        .setTimeout(30)
        .build();

      await submitSignedTransaction(tx, "Update Product");
      alert(`✅ Product ID ${updateForm.id} updated!`);
      setUpdateForm({ id: "", status: "in_transit", location: "" });
    } catch (error) {
      console.error(error);
    }
  };

  // --- Feature 3: Retrieve Product ---
  const handleRetrieveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicKey) {
      alert("Please connect your wallet first.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setRetrievedProduct(null);

    try {
      const sourceAccount = await getSourceAccount();
      const contract = new Contract(CONTRACT_ID);

      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          contract.call(
            "get_product",
            nativeToScVal(parseInt(retrieveId), { type: "u64" })
          )
        )
        .setTimeout(30)
        .build();

      const simulation = await sorobanServer.simulateTransaction(tx);

      if (SorobanRpc.Api.isSimulationSuccess(simulation)) {
        const product = scValToObject(simulation.result!.retval);

        if (product && product.timestamp) {
          product.readable_timestamp = new Date(
            parseInt(product.timestamp) * 1000
          ).toLocaleString();
        }
        setRetrievedProduct(product);
      } else {
        console.error("Error simulating get_product:", simulation);
        setError("Could not find product.");
      }
    } catch (error: any) {
      console.error(error);
      setError(error.message || "Error retrieving product");
    }
    setIsLoading(false);
  };

  // --- JSX UI ---
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <header className="text-center mb-12">
          <h1 className="text-5xl font-bold text-white mb-4">
            🚀 Supply Chain Tracker
          </h1>
          <p className="text-xl text-purple-200 mb-6">
            Built on Stellar Blockchain with Soroban
          </p>
          
          <button
            onClick={connectWallet}
            disabled={!!publicKey}
            className={`px-8 py-3 rounded-lg font-semibold text-lg transition-all ${
              publicKey
                ? "bg-green-500 text-white cursor-not-allowed"
                : "bg-purple-600 hover:bg-purple-700 text-white shadow-lg hover:shadow-purple-500/50"
            }`}
          >
            {publicKey
              ? `✅ ${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`
              : "Connect Freighter Wallet"}
          </button>

          {publicKey && (
            <div className="mt-6 inline-block bg-white/10 backdrop-blur-md rounded-lg px-6 py-3">
              <p className="text-purple-200 text-lg">
                📦 Total Products:{" "}
                <span className="text-white font-bold text-2xl">
                  {totalProducts}
                </span>
              </p>
            </div>
          )}
        </header>

        {/* Loading & Error */}
        {isLoading && (
          <div className="text-center mb-6">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
            <p className="text-white mt-2">Processing transaction...</p>
          </div>
        )}
        
        {error && (
          <div className="bg-red-500/20 border border-red-500 text-red-200 px-4 py-3 rounded-lg mb-6">
            ⚠️ {error}
          </div>
        )}

        {/* Cards Grid */}
        <div className="grid md:grid-cols-3 gap-6">
          {/* Card 1: Register Product */}
          <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 shadow-xl border border-purple-500/20">
            <h2 className="text-2xl font-bold text-white mb-4 flex items-center">
              📝 Register Product
            </h2>
            <form onSubmit={handleRegisterProduct} className="space-y-4">
              <div>
                <label className="block text-purple-200 mb-2">Product Name</label>
                <input
                  type="text"
                  name="name"
                  value={registerForm.name}
                  onChange={handleRegisterChange}
                  placeholder="e.g., Laptop XPS 15"
                  required
                  className="w-full px-4 py-2 rounded-lg bg-white/10 border border-purple-500/30 text-white placeholder-purple-300/50 focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-purple-200 mb-2">Manufacturer</label>
                <input
                  type="text"
                  name="manufacturer"
                  value={registerForm.manufacturer}
                  onChange={handleRegisterChange}
                  placeholder="e.g., Dell Inc."
                  required
                  className="w-full px-4 py-2 rounded-lg bg-white/10 border border-purple-500/30 text-white placeholder-purple-300/50 focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-purple-200 mb-2">Initial Location</label>
                <input
                  type="text"
                  name="location"
                  value={registerForm.location}
                  onChange={handleRegisterChange}
                  placeholder="e.g., Factory A, China"
                  required
                  className="w-full px-4 py-2 rounded-lg bg-white/10 border border-purple-500/30 text-white placeholder-purple-300/50 focus:outline-none focus:border-purple-500"
                />
              </div>
              <button
                type="submit"
                disabled={isLoading || !publicKey}
                className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-semibold py-3 rounded-lg transition-all shadow-lg hover:shadow-purple-500/50"
              >
                Register Product
              </button>
            </form>
            {lastProductId && (
              <div className="mt-4 bg-green-500/20 border border-green-500 text-green-200 px-4 py-3 rounded-lg">
                ✅ Success! Product ID: <strong>{lastProductId}</strong>
              </div>
            )}
          </div>

          {/* Card 2: Update Product */}
          <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 shadow-xl border border-purple-500/20">
            <h2 className="text-2xl font-bold text-white mb-4 flex items-center">
              🔄 Update Status
            </h2>
            <form onSubmit={handleUpdateProduct} className="space-y-4">
              <div>
                <label className="block text-purple-200 mb-2">Product ID</label>
                <input
                  type="number"
                  name="id"
                  value={updateForm.id}
                  onChange={handleUpdateChange}
                  placeholder="Enter product ID"
                  required
                  className="w-full px-4 py-2 rounded-lg bg-white/10 border border-purple-500/30 text-white placeholder-purple-300/50 focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-purple-200 mb-2">New Location</label>
                <input
                  type="text"
                  name="location"
                  value={updateForm.location}
                  onChange={handleUpdateChange}
                  placeholder="e.g., Warehouse B"
                  required
                  className="w-full px-4 py-2 rounded-lg bg-white/10 border border-purple-500/30 text-white placeholder-purple-300/50 focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-purple-200 mb-2">New Status</label>
                <select
                  name="status"
                  value={updateForm.status}
                  onChange={handleUpdateChange}
                  className="w-full px-4 py-2 rounded-lg bg-white/10 border border-purple-500/30 text-white focus:outline-none focus:border-purple-500"
                >
                  <option value="manufactured" className="bg-slate-800">Manufactured</option>
                  <option value="in_transit" className="bg-slate-800">In Transit</option>
                  <option value="delivered" className="bg-slate-800">Delivered</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={isLoading || !publicKey}
                className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-semibold py-3 rounded-lg transition-all shadow-lg hover:shadow-purple-500/50"
              >
                Update Product
              </button>
            </form>
          </div>

          {/* Card 3: Get Product */}
          <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 shadow-xl border border-purple-500/20">
            <h2 className="text-2xl font-bold text-white mb-4 flex items-center">
              🔍 Track Product
            </h2>
            <form onSubmit={handleRetrieveProduct} className="space-y-4">
              <div>
                <label className="block text-purple-200 mb-2">Product ID</label>
                <input
                  type="number"
                  name="retrieveId"
                  value={retrieveId}
                  onChange={(e) => setRetrieveId(e.target.value)}
                  placeholder="Enter product ID to track"
                  required
                  className="w-full px-4 py-2 rounded-lg bg-white/10 border border-purple-500/30 text-white placeholder-purple-300/50 focus:outline-none focus:border-purple-500"
                />
              </div>
              <button
                type="submit"
                disabled={isLoading || !publicKey}
                className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-semibold py-3 rounded-lg transition-all shadow-lg hover:shadow-purple-500/50"
              >
                Search Product
              </button>
            </form>

            {retrievedProduct && (
              <div className="mt-4 bg-white/5 rounded-lg p-4 border border-purple-500/30">
                <h3 className="text-lg font-semibold text-white mb-3">
                  Product Details
                </h3>
                {retrievedProduct.product_id === "0" ? (
                  <p className="text-red-300">❌ Product not found</p>
                ) : (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-purple-300">ID:</span>
                      <span className="text-white font-semibold">
                        {retrievedProduct.product_id}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-purple-300">Name:</span>
                      <span className="text-white font-semibold">
                        {retrievedProduct.name}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-purple-300">Manufacturer:</span>
                      <span className="text-white">
                        {retrievedProduct.manufacturer}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-purple-300">Location:</span>
                      <span className="text-white">
                        {retrievedProduct.current_location}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-purple-300">Status:</span>
                      <span className={`font-semibold ${
                        retrievedProduct.status === 'delivered' 
                          ? 'text-green-400' 
                          : retrievedProduct.status === 'in_transit'
                          ? 'text-yellow-400'
                          : 'text-blue-400'
                      }`}>
                        {retrievedProduct.status}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-purple-300">Last Updated:</span>
                      <span className="text-white text-xs">
                        {retrievedProduct.readable_timestamp}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center mt-12 text-purple-300">
          <p>Built with ❤️ on Stellar Blockchain</p>
          <p className="text-sm mt-2">Powered by Soroban Smart Contracts</p>
        </footer>
      </div>
    </div>
  );
}
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface BargainData {
  id: string;
  name: string;
  encryptedPrice: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
}

interface BargainAnalysis {
  priceMatch: number;
  negotiationScore: number;
  dealProbability: number;
  timeSensitivity: number;
  marketPosition: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [bargains, setBargains] = useState<BargainData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingBargain, setCreatingBargain] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newBargainData, setNewBargainData] = useState({ name: "", price: "", description: "" });
  const [selectedBargain, setSelectedBargain] = useState<BargainData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [userHistory, setUserHistory] = useState<string[]>([]);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);

  const itemsPerPage = 5;
  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const bargainsList: BargainData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          bargainsList.push({
            id: businessId,
            name: businessData.name,
            encryptedPrice: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setBargains(bargainsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createBargain = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingBargain(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating bargain with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const priceValue = parseInt(newBargainData.price) || 0;
      const businessId = `bargain-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, priceValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newBargainData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newBargainData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setUserHistory(prev => [...prev, `Created bargain: ${newBargainData.name}`]);
      setTransactionStatus({ visible: true, status: "success", message: "Bargain created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewBargainData({ name: "", price: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingBargain(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      setUserHistory(prev => [...prev, `Decrypted bargain: ${businessId}`]);
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Price decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      setUserHistory(prev => [...prev, "Checked contract availability"]);
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const analyzeBargain = (bargain: BargainData, decryptedPrice: number | null): BargainAnalysis => {
    const price = bargain.isVerified ? (bargain.decryptedValue || 0) : (decryptedPrice || 100);
    const timeFactor = Math.max(0.5, Math.min(1.5, 1 - (Date.now()/1000 - bargain.timestamp) / (60 * 60 * 24 * 7)));
    
    const priceMatch = Math.min(100, Math.round((1000 / (price + 1)) * 10 * timeFactor));
    const negotiationScore = Math.round((bargain.publicValue1 * 8 + Math.log(price + 1) * 2) * timeFactor);
    const dealProbability = Math.min(95, Math.round((price * 0.3 + bargain.publicValue1 * 7) * timeFactor));
    const timeSensitivity = Math.max(10, Math.min(90, 100 - (Date.now()/1000 - bargain.timestamp) / (60 * 60)));
    const marketPosition = Math.round((price * 0.6 + bargain.publicValue1 * 0.4) * 2 * timeFactor);

    return { priceMatch, negotiationScore, dealProbability, timeSensitivity, marketPosition };
  };

  const filteredBargains = bargains.filter(bargain => 
    bargain.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    bargain.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const paginatedBargains = filteredBargains.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(filteredBargains.length / itemsPerPage);

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>FHE Bargaining Bot 🔐</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">💎</div>
            <h2>Connect Wallet to Start Private Bargaining</h2>
            <p>Securely negotiate prices with fully homomorphic encryption protecting your bids</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted bargaining system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE Bargaining Bot 💎</h1>
        </div>
        
        <div className="header-actions">
          <button onClick={callIsAvailable} className="test-btn">Test Contract</button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">+ Create Bargain</button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panel">
          <div className="stat-card">
            <div className="stat-value">{bargains.length}</div>
            <div className="stat-label">Total Bargains</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{bargains.filter(b => b.isVerified).length}</div>
            <div className="stat-label">Verified Prices</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{userHistory.length}</div>
            <div className="stat-label">Your Actions</div>
          </div>
        </div>

        <div className="search-section">
          <input
            type="text"
            placeholder="Search bargains..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <button onClick={loadData} className="refresh-btn">
            {isRefreshing ? "🔄" : "Refresh"}
          </button>
        </div>

        <div className="bargains-list">
          {paginatedBargains.length === 0 ? (
            <div className="no-bargains">
              <p>No bargaining proposals found</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                Create First Bargain
              </button>
            </div>
          ) : (
            paginatedBargains.map((bargain, index) => (
              <BargainItem 
                key={index}
                bargain={bargain}
                onSelect={setSelectedBargain}
                onDecrypt={decryptData}
              />
            ))
          )}
        </div>

        {totalPages > 1 && (
          <div className="pagination">
            <button 
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </button>
            <span>Page {currentPage} of {totalPages}</span>
            <button 
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </button>
          </div>
        )}

        <div className="history-panel">
          <h3>Your Activity History</h3>
          <div className="history-list">
            {userHistory.slice(-5).map((action, index) => (
              <div key={index} className="history-item">{action}</div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <CreateBargainModal 
          onSubmit={createBargain}
          onClose={() => setShowCreateModal(false)}
          creating={creatingBargain}
          bargainData={newBargainData}
          setBargainData={setNewBargainData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedBargain && (
        <BargainDetailModal 
          bargain={selectedBargain}
          onClose={() => setSelectedBargain(null)}
          onDecrypt={decryptData}
          analyzeBargain={analyzeBargain}
        />
      )}
      
      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          {transactionStatus.message}
        </div>
      )}
    </div>
  );
};

const BargainItem: React.FC<{
  bargain: BargainData;
  onSelect: (bargain: BargainData) => void;
  onDecrypt: (id: string) => Promise<number | null>;
}> = ({ bargain, onSelect, onDecrypt }) => {
  const [decrypting, setDecrypting] = useState(false);

  const handleDecrypt = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDecrypting(true);
    await onDecrypt(bargain.id);
    setDecrypting(false);
  };

  return (
    <div className="bargain-item" onClick={() => onSelect(bargain)}>
      <div className="bargain-header">
        <h3>{bargain.name}</h3>
        <span className={`status ${bargain.isVerified ? 'verified' : 'encrypted'}`}>
          {bargain.isVerified ? '✅ Verified' : '🔒 Encrypted'}
        </span>
      </div>
      <p>{bargain.description}</p>
      <div className="bargain-footer">
        <span>By: {bargain.creator.substring(0, 6)}...{bargain.creator.substring(38)}</span>
        <span>{new Date(bargain.timestamp * 1000).toLocaleDateString()}</span>
        <button 
          onClick={handleDecrypt}
          disabled={decrypting || bargain.isVerified}
          className={`decrypt-btn ${bargain.isVerified ? 'verified' : ''}`}
        >
          {decrypting ? 'Decrypting...' : bargain.isVerified ? 'Decrypted' : 'Decrypt Price'}
        </button>
      </div>
    </div>
  );
};

const CreateBargainModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  bargainData: any;
  setBargainData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, bargainData, setBargainData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'price') {
      const intValue = value.replace(/[^\d]/g, '');
      setBargainData({ ...bargainData, [name]: intValue });
    } else {
      setBargainData({ ...bargainData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2>Create New Bargain</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE Protected Pricing</strong>
            <p>Your price will be encrypted using fully homomorphic encryption</p>
          </div>
          
          <div className="form-group">
            <label>Item Name *</label>
            <input 
              type="text"
              name="name"
              value={bargainData.name}
              onChange={handleChange}
              placeholder="Enter item name..."
            />
          </div>
          
          <div className="form-group">
            <label>Your Price (Integer only) *</label>
            <input 
              type="number"
              name="price"
              value={bargainData.price}
              onChange={handleChange}
              placeholder="Enter your price..."
              min="0"
            />
            <div className="input-hint">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea
              name="description"
              value={bargainData.description}
              onChange={handleChange}
              placeholder="Describe the item..."
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit}
            disabled={creating || isEncrypting || !bargainData.name || !bargainData.price}
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Bargain"}
          </button>
        </div>
      </div>
    </div>
  );
};

const BargainDetailModal: React.FC<{
  bargain: BargainData;
  onClose: () => void;
  onDecrypt: (id: string) => Promise<number | null>;
  analyzeBargain: (bargain: BargainData, decryptedPrice: number | null) => BargainAnalysis;
}> = ({ bargain, onClose, onDecrypt, analyzeBargain }) => {
  const [decryptedPrice, setDecryptedPrice] = useState<number | null>(null);
  const [decrypting, setDecrypting] = useState(false);

  const handleDecrypt = async () => {
    setDecrypting(true);
    const price = await onDecrypt(bargain.id);
    setDecryptedPrice(price);
    setDecrypting(false);
  };

  const analysis = analyzeBargain(bargain, decryptedPrice);

  return (
    <div className="modal-overlay">
      <div className="modal detail-modal">
        <div className="modal-header">
          <h2>{bargain.name}</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="bargain-info">
            <p>{bargain.description}</p>
            <div className="info-grid">
              <div>Creator: {bargain.creator.substring(0, 6)}...{bargain.creator.substring(38)}</div>
              <div>Created: {new Date(bargain.timestamp * 1000).toLocaleDateString()}</div>
            </div>
          </div>

          <div className="price-section">
            <h3>Encrypted Price</h3>
            <div className="price-display">
              {bargain.isVerified ? (
                <div className="decrypted-price">${bargain.decryptedValue}</div>
              ) : decryptedPrice !== null ? (
                <div className="decrypted-price">${decryptedPrice}</div>
              ) : (
                <div className="encrypted-price">🔒 FHE Encrypted</div>
              )}
              <button 
                onClick={handleDecrypt}
                disabled={decrypting || bargain.isVerified}
                className={`decrypt-btn large ${bargain.isVerified ? 'verified' : ''}`}
              >
                {decrypting ? 'Decrypting...' : bargain.isVerified ? '✅ Verified' : '🔓 Decrypt Price'}
              </button>
            </div>
          </div>

          {(bargain.isVerified || decryptedPrice !== null) && (
            <div className="analysis-section">
              <h3>Bargaining Analysis</h3>
              <div className="analysis-chart">
                {Object.entries(analysis).map(([key, value]) => (
                  <div key={key} className="analysis-row">
                    <span className="analysis-label">{key.replace(/([A-Z])/g, ' $1')}:</span>
                    <div className="analysis-bar">
                      <div 
                        className="bar-fill"
                        style={{ width: `${value}%` }}
                      >
                        <span>{value}%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;



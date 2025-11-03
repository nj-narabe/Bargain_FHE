pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract BargainFHE is ZamaEthereumConfig {
    struct BargainSession {
        address buyer;
        address seller;
        euint32 encryptedBuyerPrice;
        euint32 encryptedSellerPrice;
        uint256 publicBuyerPrice;
        uint256 publicSellerPrice;
        bool buyerRevealed;
        bool sellerRevealed;
        bool dealMatched;
        uint256 timestamp;
    }

    mapping(bytes32 => BargainSession) public sessions;
    bytes32[] public sessionIds;

    event SessionCreated(bytes32 indexed sessionId, address indexed buyer, address indexed seller);
    event PriceRevealed(bytes32 indexed sessionId, address indexed revealer, uint256 price);
    event DealMatched(bytes32 indexed sessionId, uint256 price);

    constructor() ZamaEthereumConfig() {}

    function createSession(
        externalEuint32 encryptedBuyerPrice,
        externalEuint32 encryptedSellerPrice,
        bytes calldata buyerProof,
        bytes calldata sellerProof,
        uint256 publicBuyerPrice,
        uint256 publicSellerPrice
    ) external returns (bytes32) {
        bytes32 sessionId = keccak256(abi.encodePacked(msg.sender, block.timestamp));

        require(sessions[sessionId].timestamp == 0, "Session already exists");

        euint32 encryptedBuyer = FHE.fromExternal(encryptedBuyerPrice, buyerProof);
        euint32 encryptedSeller = FHE.fromExternal(encryptedSellerPrice, sellerProof);

        require(FHE.isInitialized(encryptedBuyer), "Invalid buyer encryption");
        require(FHE.isInitialized(encryptedSeller), "Invalid seller encryption");

        sessions[sessionId] = BargainSession({
            buyer: msg.sender,
            seller: address(0),
            encryptedBuyerPrice: encryptedBuyer,
            encryptedSellerPrice: encryptedSeller,
            publicBuyerPrice: publicBuyerPrice,
            publicSellerPrice: publicSellerPrice,
            buyerRevealed: false,
            sellerRevealed: false,
            dealMatched: false,
            timestamp: block.timestamp
        });

        FHE.allowThis(encryptedBuyer);
        FHE.allowThis(encryptedSeller);

        sessionIds.push(sessionId);
        emit SessionCreated(sessionId, msg.sender, address(0));
        return sessionId;
    }

    function joinSession(
        bytes32 sessionId,
        externalEuint32 encryptedSellerPrice,
        bytes calldata sellerProof,
        uint256 publicSellerPrice
    ) external {
        require(sessions[sessionId].timestamp > 0, "Session does not exist");
        require(sessions[sessionId].seller == address(0), "Session already joined");

        euint32 encryptedSeller = FHE.fromExternal(encryptedSellerPrice, sellerProof);
        require(FHE.isInitialized(encryptedSeller), "Invalid seller encryption");

        sessions[sessionId].seller = msg.sender;
        sessions[sessionId].encryptedSellerPrice = encryptedSeller;
        sessions[sessionId].publicSellerPrice = publicSellerPrice;

        FHE.allowThis(encryptedSeller);

        emit SessionCreated(sessionId, sessions[sessionId].buyer, msg.sender);
    }

    function revealBuyerPrice(
        bytes32 sessionId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(sessions[sessionId].timestamp > 0, "Session does not exist");
        require(msg.sender == sessions[sessionId].buyer, "Only buyer can reveal");
        require(!sessions[sessionId].buyerRevealed, "Buyer already revealed");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(sessions[sessionId].encryptedBuyerPrice);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint256 revealedPrice = abi.decode(abiEncodedClearValue, (uint256));
        sessions[sessionId].publicBuyerPrice = revealedPrice;
        sessions[sessionId].buyerRevealed = true;

        emit PriceRevealed(sessionId, msg.sender, revealedPrice);

        if (sessions[sessionId].sellerRevealed) {
            checkDeal(sessionId);
        }
    }

    function revealSellerPrice(
        bytes32 sessionId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(sessions[sessionId].timestamp > 0, "Session does not exist");
        require(msg.sender == sessions[sessionId].seller, "Only seller can reveal");
        require(!sessions[sessionId].sellerRevealed, "Seller already revealed");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(sessions[sessionId].encryptedSellerPrice);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint256 revealedPrice = abi.decode(abiEncodedClearValue, (uint256));
        sessions[sessionId].publicSellerPrice = revealedPrice;
        sessions[sessionId].sellerRevealed = true;

        emit PriceRevealed(sessionId, msg.sender, revealedPrice);

        if (sessions[sessionId].buyerRevealed) {
            checkDeal(sessionId);
        }
    }

    function checkDeal(bytes32 sessionId) internal {
        if (sessions[sessionId].publicBuyerPrice >= sessions[sessionId].publicSellerPrice) {
            sessions[sessionId].dealMatched = true;
            emit DealMatched(sessionId, sessions[sessionId].publicSellerPrice);
        }
    }

    function getEncryptedPrices(bytes32 sessionId) external view returns (euint32, euint32) {
        require(sessions[sessionId].timestamp > 0, "Session does not exist");
        return (sessions[sessionId].encryptedBuyerPrice, sessions[sessionId].encryptedSellerPrice);
    }

    function getSession(bytes32 sessionId) external view returns (
        address buyer,
        address seller,
        uint256 publicBuyerPrice,
        uint256 publicSellerPrice,
        bool buyerRevealed,
        bool sellerRevealed,
        bool dealMatched,
        uint256 timestamp
    ) {
        require(sessions[sessionId].timestamp > 0, "Session does not exist");
        BargainSession storage session = sessions[sessionId];
        return (
            session.buyer,
            session.seller,
            session.publicBuyerPrice,
            session.publicSellerPrice,
            session.buyerRevealed,
            session.sellerRevealed,
            session.dealMatched,
            session.timestamp
        );
    }

    function getAllSessionIds() external view returns (bytes32[] memory) {
        return sessionIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}



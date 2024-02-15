const { Web3 } = require('web3');
const aaveOracleAbi = require('../constants/aaveOracleAbi.json');
const { BigNumber } = require('bignumber.js');
var pool = require('../database');

// Initialize Web3 with your RPC endpoint
const chainIdtoUrl = require('../constants/chainId.json');
const addresses = require('../constants/addresses.json')

module.exports.getMethodName = async function(req, res) {
   try {
      const { tx , chainID } = req.body;

      console.log("chainID", chainID);
      console.log("chainIdtoUrl[chainID]", chainIdtoUrl[chainID]);

      const url = chainIdtoUrl[chainID];

      const web3 = new Web3(url);

      // Get transaction details
      const transaction = await web3.eth.getTransaction(tx);

      const signer = transaction.from;

      console.log("transaction", transaction.to);

      function findKeyName(data, contractAddress, chainId) {
        const chainData = data[chainId];
        
        if (!chainData) {
          return null; // Chain ID not found
        }
        
        for (const key in chainData) {
          if (chainData.hasOwnProperty(key) && chainData[key] === contractAddress) {
            return key;
          }
        }
        
        return null; // Contract address not found for the given chain ID
      }

      const keyName = findKeyName(addresses, transaction.to, chainID);
      console.log(keyName); // Output: pool

      

      // Get contract ABI (Application Binary Interface)
      const abi = (keyName == "router") ? require('../constants/routerAbi.json') : require('../constants/poolAbi.json'); // Load your contract ABI

      // Decode input data to get method name and parameters
      const inputData = transaction.input;
      const functionSignature = inputData.slice(0, 10); // Function signature is first 4 bytes (8 characters) of input data

      // Find the function signature in the contract ABI
      const method = abi.find((element) => {
          return element.type === 'function' && web3.eth.abi.encodeFunctionSignature(element) === functionSignature;
      });

      let methodName, decodedParams;
      
      if (method) {
          // Extract method name
          methodName = method.name;
          
          // Decode parameters
          const inputTypes = method.inputs.map(input => input.type);
          const params = inputData.slice(10); // Parameters start after the function signature
          decodedParams = web3.eth.abi.decodeParameters(inputTypes, params);
      } else {
          methodName = 'Unknown';
          decodedParams = {};
      }

      // Fetch asset price
      const priceOracleContract = new web3.eth.Contract(aaveOracleAbi, addresses[chainID].aaveOracle);
      let assetPrice1, assetPrice2;
      let amountA, amountB;
      let rewardPoints;

      if (keyName === "router") {
          assetPrice1 = await priceOracleContract.methods.getAssetPrice(decodedParams[0]).call();
          assetPrice2 = await priceOracleContract.methods.getAssetPrice(decodedParams[1]).call();

             amountA = new BigNumber(decodedParams[2]); // 1e18
             amountB = new BigNumber(decodedParams[3]); // 1e18
            const priceA = new BigNumber(assetPrice1); // 1e8
            const priceB = new BigNumber(assetPrice2); // 1e8

            // Calculate total USD value
            const totalUSD = amountA.div(1e18).multipliedBy(priceA).plus(amountB.div(1e18).multipliedBy(priceB));
            const result = totalUSD.div(1e8);

            rewardPoints = result.div(50).multipliedBy(100);
      } else {
          assetPrice1 = await priceOracleContract.methods.getAssetPrice(decodedParams[0]).call();
          amountA = new BigNumber(decodedParams[1]); // 1e18
          const priceA = new BigNumber(assetPrice1); // 1e8

          // Calculate total USD value
          const totalUSD = amountA.div(1e18).multipliedBy(priceA);
          const result = totalUSD.div(1e8);
          const rewardUnit = (methodName == "deposit") ?  50 : (methodName == "borrow") ? 50 : 30;
          rewardPoints = result.div(rewardUnit).multipliedBy(100);
      }

      pool.query(
        `SELECT * FROM transactions WHERE tx_id = ?;`,
        [tx],
        (err, existingTransaction) => {
            if (err) {
                throw err;
            }
            
            if (existingTransaction.length > 0) {
                return res.status(400).send({
                    msg: 'Transaction already exists'
                });
            }else {
              pool.query(
                `select * from points where signer = ?;`,
                [signer],
                (err, result) => {
                  if (err) {
                    throw err;
                  }
                  if(result.length == 0){
                    pool.query(
                        `INSERT INTO points (signer, total_points) VALUES (?, ?);`,
                        [signer, rewardPoints.toNumber()],
                        (err, result) => {
                            if (err) {
                                throw err;
                            }
        
                            const signer_id = result.insertId; // Get the ID of the inserted row
        
                            console.log("result", result);
        
                            pool.query(
                                `INSERT INTO transactions (signer_id, tx_id, chainId, action, tx_points, asset1, asset2) VALUES (?, ?, ?, ?, ?, ?, ?);`,
                                [signer_id, tx, chainID, methodName, rewardPoints.toNumber(), (amountA.div(1e18)).toNumber(), amountB ? (amountB.div(1e18)).toNumber() : null],
                                (err, result1) => {
                                    if (err) {
                                        throw err;
                                    }
        
                                    return res.status(200).send({
                                        msg: 'Data added successfully to points and transactions tables'
                                    });
                                }
                            );
                        }
                    );
                  } else {
                    console.log("result.total_points", result[0].total_points, result[0].total_points + rewardPoints.toNumber());
                    pool.query(
                        `UPDATE points SET total_points = ? WHERE signer = ?;`,
                        [result[0].total_points + rewardPoints.toNumber(), signer],
                        (err, result2) => {
                            if (err) {
                                throw err;
                            }
                            
                            pool.query(
                                `INSERT INTO transactions (signer_id, tx_id, chainId, action, tx_points, asset1, asset2) VALUES (?, ?, ?, ?, ?, ?, ?);`,
                                [result[0].id, tx, chainID, methodName, rewardPoints.toNumber(), (amountA.div(1e18)).toNumber(),amountB ? (amountB.div(1e18)).toNumber() : null],
                                (err, result1) => {
                                    if (err) {
                                        throw err;
                                    }
        
                                    return res.status(200).send({
                                        msg: 'Data added successfully to points and transactions tables'
                                    });
                                }
                            );
                        }
                    );
                  }
                }
              );

            }
    
        
        }
    );
    

      
      
      // Send method name and decoded parameters as response
      // res.status(200).json({ success: true, methodName, decodedParams, assetPrice1, assetPrice2, rewardPoints});
   } catch(err) { 
      console.log("error", err);
       // Handle errors
       res.status(500).json({ responseCode: 500 , err : err.message });
   }
}

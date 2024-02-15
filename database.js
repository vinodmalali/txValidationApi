const {createPool} = require("mysql");

const pool = createPool({
    port : 3307,
    host: "localhost",
    user: "root",
    password: "sakha@123",
    database: "Sakha_Finance"
    
});

module.exports  =  
    pool;
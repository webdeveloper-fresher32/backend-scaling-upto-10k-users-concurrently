const mongoose = require("mongoose");



const connectDatabase = async () => {
    const mongoURI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/scale_db_with_redis';

    const options = {
        // Maintain between minPoolSize and maxPoolSize connections per process
        minPoolSize:10,
        maxPoolSize:50,

       // Timeout if a connection cannot be acquired from pool within 5 seconds
        waitQueueTimeoutMS: 5000,
    
        // Close idle sockets after 30 seconds
        maxIdleTimeMS: 30000,
    
        // Fast fail for network disconnects
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
    }

    try {
        await mongoose.connect(mongoURI,options);
        console.log(`Database : connection successfully to ${mongoURI}`);
    } catch (error) {
        console.error(`Database :  connection failed`,error.message);
        process.exit(1)
    }

    mongoose.connection.on("disconnected",()=>{
        console.warn("Databse : lost connection to mongoDB");
    })

    mongoose.connection.on("reconnected",()=>{
        console.log("Database : reconnected to mongoDB")
    })
}

module.exports={connectDatabase}
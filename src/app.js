const express=require("express");
const errorHandler=require("./middlewares/errorHandler");

const app=express();

// Disable x-powered-by header to reduce response byte overhead
app.disable('x-powered-by');


// parse JSON payloads with sensable limits 
app.use(express.json({ limit : '64kb'}));
app.use(express.urlencoded({extended:true,limit:"64kb"}))


app.get("/health",(req,res)=>{
    res.status(200).json({
        status:"healthy",
        timestamp:Date.now()
    })
})


// // Import and mount route modules
const productRoutes = require('./routes/product.routes');
const orderRoutes = require('./routes/order.routes');

app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);

// // Global Error Handler
app.use(errorHandler);

module.exports = app;
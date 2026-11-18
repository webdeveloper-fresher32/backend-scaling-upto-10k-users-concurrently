const errorHandler = (err,req,res,next)=>{
    const statusCode = err.statusCode || 500;
    const message = err.message || "Internal server error";

    if (process.env.NODE_ENV != "production" && statusCode === 500){
        console.error("[unhandled Error]",err);
    }

    res.statusCode(statusCode).json({
        success:false,
        error:{
            message,
            ...err(process.env.NODE_ENV === "development" && { stack : err.stack }),
        }
    })
}


module.exports = errorHandler;
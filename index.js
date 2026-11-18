const express=require("express")



const app=express()

app.get("/",(req,res)=>{
    res.send("Hello from server")
})



const PORT=process.env.PORT
app.listen(()=>{
    console.log(`port running on ${PORT}`)
})

const  mongoose = require ("mongoose");

const orderItemSchema = new mongoose.Schema(
    {
        productId : { type : mongoose.Schema.Types.ObjectId , ref: "Product", required: true },
        quantity : { type : Number , require : true , min : 1 },
        unitPrice : { type : Number , required : true }
    },
    { _id : false }
)


const orderSchema  = new mongoose.Schema(
   {
    userId: { type: String, required: true },
    items: [orderItemSchema],
    totalAmount: { type: Number, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'CONFIRMED', 'CANCELLED'],
      default: 'PENDING',
    },
    paymentSignature: { type: String },
  },
  { timestamps: true }
)

module.exports = mongoose.model("Order",orderSchema)
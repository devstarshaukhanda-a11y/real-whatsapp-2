import mongoose from "mongoose";
 
const statusSchema = new mongoose.Schema({

  phone: String,

  name: String,

  text: String,

  image: String,

  createdAt: {

    type: Date,

    default: Date.now,

    expires: 60 * 60 * 24 // 👈 24 HOURS AUTO DELETE

  }

});
 
export default mongoose.model("Status", statusSchema);
 
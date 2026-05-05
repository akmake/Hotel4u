// server/models/PriceList.js
import mongoose from 'mongoose';

const priceListSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },

  hotel: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hotel',
    required: [true, 'חובה לשייך מחירון למלון'],
  },
  couple: { type: Number, default: 0, min: 0 },
  teen: { type: Number, default: 0, min: 0 },
  child: { type: Number, default: 0, min: 0 },
  baby: { type: Number, default: 0, min: 0 },
  single_room: { type: Number, default: 0, min: 0 },
  
  fixedNights: { 
    type: Number, 
    default: 0,
    min: 0 
  },

  maxNights: {
    type: Number,
    default: 0, 
    min: 0
  },

  isVisible: {
    type: Boolean,
    default: true
  },

  displayOrder: {
    type: Number,
    default: 0
  },

  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, { timestamps: true });

priceListSchema.index({ name: 1, hotel: 1 }, { unique: true });

const PriceList = mongoose.models.PriceList || mongoose.model('PriceList', priceListSchema);

export default PriceList;
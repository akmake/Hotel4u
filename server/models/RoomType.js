import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const RoomTypeSchema = new Schema({
  property:          { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  code:              { type: String, required: true },
  name:              { type: String, required: true },
  shortDesc:         String,
  fullDesc:          String,
  capacityBase:      { type: Number, default: 2 },
  capacityMax:       { type: Number, default: 2 },
  baseRate:          { type: Number, required: true },

  // Physical
  bedType:           { type: String, enum: ['king', 'queen', 'twin', 'double', 'single', 'bunk', 'mixed', 'other'], default: 'double' },
  extraBedAllowed:   { type: Boolean, default: false },
  cribAllowed:       { type: Boolean, default: true },
  roomSizeSqm:       Number,
  view:              { type: String, enum: ['sea', 'garden', 'city', 'mountain', 'pool', 'interior', 'courtyard', 'other'] },
  amenities:         [String],

  // Sales
  sellable:          { type: Boolean, default: true },
  showInEngine:      { type: Boolean, default: true },
  overbookingAllowed:{ type: Boolean, default: false },
  overbookingLimit:  { type: Number, default: 0 },

  active:            { type: Boolean, default: true },
  sortOrder:         { type: Number, default: 0 },
}, { timestamps: true });

export default model('RoomType', RoomTypeSchema);

import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const PropertySchema = new Schema({
  name:             { type: String, required: true },
  legalName:        String,
  timezone:         { type: String, default: 'Asia/Jerusalem' },
  defaultCurrency:  { type: String, default: 'ILS' },
  address:          String,
  city:             String,
  country:          { type: String, default: 'IL' },
  phone:            String,
  email:            String,
  website:          String,
  checkInTime:      { type: String, default: '15:00' },
  checkOutTime:     { type: String, default: '11:00' },
  totalRooms:       { type: Number, default: 0 },

  // Tax & billing
  taxNumber:        String,        // ח.פ. / מספר עוסק
  vatRate:          { type: Number, default: 17 },
  invoicePrefix:    { type: String, default: 'INV' },
  invoiceSequence:  { type: Number, default: 1000 },

  // Policies
  defaultCancellationHours: { type: Number, default: 24 },
  defaultCancellationFee:   { type: String, default: 'לילה ראשון' },
  petPolicy:        { type: String, enum: ['not_allowed', 'on_request', 'allowed'], default: 'not_allowed' },
  smokingPolicy:    { type: String, enum: ['non_smoking', 'designated_areas', 'allowed'], default: 'non_smoking' },
  childrenPolicy:   String,

  active:           { type: Boolean, default: true },
}, { timestamps: true });

export default model('Property', PropertySchema);

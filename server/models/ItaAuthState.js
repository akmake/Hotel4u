// One-time OAuth "state" for connecting a property to the Tax Authority (FIN-10-A03): ties the
// browser redirect back to the property and the user who started it; expires in 15 minutes.
import mongoose from 'mongoose';

const ItaAuthStateSchema = new mongoose.Schema({
  state:     { type: String, required: true, unique: true },
  property:  { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true },
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  userName:  String,
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

ItaAuthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('ItaAuthState', ItaAuthStateSchema);

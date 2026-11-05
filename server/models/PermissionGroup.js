// Custom permission groups (gap-map item 11): an overlay on top of a user's built-in role.
// A group adds (grants) or removes (denies) sensitive capabilities, can inherit another group ("shift
// manager" = "clerk" + more) and can limit the charge codes and report groups its members may use.
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const PermissionGroupSchema = new Schema({
  property:    { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  name:        { type: String, required: true, trim: true, maxlength: 60 },
  description: { type: String, maxlength: 300 },
  parent:      { type: Schema.Types.ObjectId, ref: 'PermissionGroup' },   // inherits grants / denies / limits
  grants:      { type: [String], default: [] },                            // capability keys added to the member's role
  denies:      { type: [String], default: [] },                            // capability keys taken away (a deny beats a grant of the same group)
  chargeCodes: { type: [String], default: [] },                            // manual posting limited to these codes (empty = no limit; inherits when empty)
  reportGroups:{ type: [String], default: [] },                            // report-center groups the members may open (empty = all; inherits when empty)
  active:      { type: Boolean, default: true },
  updatedByName: String,
}, { timestamps: true });
PermissionGroupSchema.index({ property: 1, name: 1 }, { unique: true });

export default mongoose.models.PermissionGroup || model('PermissionGroup', PermissionGroupSchema);

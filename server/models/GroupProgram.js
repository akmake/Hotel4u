// Group programme (gap-map item 6, knowledge 14): the day-by-day schedule of a group — meals and
// activities, in a hall or a free location — and the meal catalog the kitchen works from.
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

export const KOSHER = ['meat', 'dairy', 'parve'];
export const KOSHER_LABELS = { meat: 'בשרי', dairy: 'חלבי', parve: 'פרווה' };
export const PROGRAM_KINDS = ['meal', 'activity', 'general'];
export const PROGRAM_KIND_LABELS = { meal: 'ארוחה', activity: 'פעילות', general: 'כללי' };

// A meal in the catalog: which kashrut it may be served in, and its menu options.
const MealTypeSchema = new Schema({
  property:    { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  name:        { type: String, required: true, trim: true },
  kosher:      { type: [{ type: String, enum: KOSHER }], default: ['meat', 'dairy', 'parve'] },
  menus:       { type: [String], default: [] },
  sortOrder:   { type: Number, default: 0 },
  active:      { type: Boolean, default: true },
}, { timestamps: true });
MealTypeSchema.index({ property: 1, name: 1 }, { unique: true });
export const MealType = model('MealType', MealTypeSchema);

// One line of the schedule. A meal must be in a hall; anything else may be in a free location.
// kitchenDay: a meal between 00:00 and 05:59 belongs to the previous day in the kitchen.
const GroupProgramItemSchema = new Schema({
  property:    { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  group:       { type: Schema.Types.ObjectId, ref: 'GroupBlock', required: true },
  date:        { type: String, required: true },            // YYYY-MM-DD
  start:       { type: String, required: true },            // HH:MM
  end:         { type: String, required: true },            // HH:MM (may pass midnight)
  kind:        { type: String, enum: PROGRAM_KINDS, default: 'general' },
  title:       { type: String, required: true, trim: true },
  space:       { type: Schema.Types.ObjectId, ref: 'EventSpace' },
  location:    String,                                       // free location when there is no hall
  mealType:    { type: Schema.Types.ObjectId, ref: 'MealType' },
  kosher:      { type: String, enum: KOSHER },
  menu:        String,
  pax:         { type: Number, default: 0, min: 0 },
  pricePerPax: { type: Number, default: 0, min: 0 },          // incl. VAT
  kitchenNotes: String,
  notes:       String,
  kitchenDay:  { type: String, required: true },
  createdByName: String,
  updatedByName: String,
}, { timestamps: true });
GroupProgramItemSchema.index({ property: 1, group: 1, date: 1, start: 1 });
GroupProgramItemSchema.index({ property: 1, kitchenDay: 1, kind: 1 });
GroupProgramItemSchema.index({ property: 1, space: 1, date: 1 });
export const GroupProgramItem = model('GroupProgramItem', GroupProgramItemSchema);

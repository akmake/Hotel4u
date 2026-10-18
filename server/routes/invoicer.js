import {Router} from 'express';
import mongoose from 'mongoose';
import Property from '../models/Property.js';
import {requireRoles,assertPropertyScope} from '../middleware/authContext.js';
import {asyncHandler} from '../middleware/errorHandler.js';
import {invoicerConfigured,invoicerClient} from '../services/invoicerClient.js';
const router=Router();
const read=['super_admin','chain_admin','property_admin','general_manager','finance_manager','auditor','owner_readonly'];
function scope(req,roles=read){requireRoles(req,roles);const id=req.query.propertyId||req.body?.propertyId||req.actor.propertyId;if(!mongoose.isValidObjectId(id))throw Object.assign(new Error('יש לבחור נכס'),{status:400});assertPropertyScope(req,String(id));return String(id);}
router.get('/status',asyncHandler(async(req,res)=>{scope(req);res.json({success:true,data:{configured:invoicerConfigured(),mode:'sandbox',connection:'server-to-server'}});}));
router.get('/overview',asyncHandler(async(req,res)=>{const id=scope(req);res.json({success:true,data:await invoicerClient().overview(id)});}));
router.post('/connect',asyncHandler(async(req,res)=>{const id=scope(req,['super_admin','chain_admin','finance_manager']);const property=await Property.findById(id).select('name legalName taxNumber address city').lean();if(!property)throw Object.assign(new Error('הנכס לא נמצא'),{status:404});const input={legalName:req.body.legalName||property.legalName||property.name,taxId:req.body.taxId||property.taxNumber,address:req.body.address||property.address,city:req.body.city||property.city};res.json({success:true,data:await invoicerClient().connectWorkspace(property,input)});}));
export default router;

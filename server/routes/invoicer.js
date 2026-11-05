import {Router} from 'express';
import mongoose from 'mongoose';
import Property from '../models/Property.js';
import Invoice from '../models/Invoice.js';
import {requireRoles,assertPropertyScope} from '../middleware/authContext.js';
import {asyncHandler} from '../middleware/errorHandler.js';
import {invoicerConfigured,invoicerClient} from '../services/invoicerClient.js';
import {syncInvoicerDocuments,documentIssuer} from '../services/documentService.js';
const router=Router();
const read=['super_admin','chain_admin','property_admin','general_manager','finance_manager','auditor','owner_readonly'];
const manage=['super_admin','chain_admin','property_admin','finance_manager'];
function scope(req,roles=read){requireRoles(req,roles);const id=req.query.propertyId||req.body?.propertyId||req.actor.propertyId;if(!mongoose.isValidObjectId(id))throw Object.assign(new Error('יש לבחור נכס'),{status:400});assertPropertyScope(req,String(id));return String(id);}
const host=()=>{try{return new URL(process.env.INVOICER_API_URL).host;}catch{return null;}};
const wsDto=(w)=>w&&({id:String(w._id),name:w.name,legalName:w.legalName||null,taxNumber:w.taxNumber||null,address:w.address||null,city:w.city||null,environment:w.environment||'sandbox',connectedAt:w.createdAt||null});

// What the settings screen shows: is the server linked, is this property connected, in which
// environment, how many documents went through, and the property details used to connect.
router.get('/status',asyncHandler(async(req,res)=>{
  const id=scope(req);
  const property=await Property.findById(id).select('name legalName taxNumber address city').lean();
  const defaults={legalName:property?.legalName||property?.name||'',taxId:property?.taxNumber||'',address:typeof property?.address==='string'?property.address:property?.address?.line1||'',city:property?.city||''};
  const base={issuer:documentIssuer(),configured:invoicerConfigured(),host:host(),connection:'server-to-server',defaults};
  if(!base.configured)return res.json({success:true,data:{...base,connected:false}});
  let workspace=null,error=null;
  try{workspace=await invoicerClient().findWorkspace(id);}catch(e){error=e.message;}
  const counts=workspace?await Invoice.aggregate([{$match:{property:new mongoose.Types.ObjectId(id),issuer:'invoicer'}},{$group:{_id:'$type',n:{$sum:1}}}]):[];
  res.json({success:true,data:{...base,connected:!!workspace,reachable:!error,error,workspace:wsDto(workspace),documents:Object.fromEntries(counts.map((c)=>[c._id,c.n]))}});
}));
router.get('/overview',asyncHandler(async(req,res)=>{const id=scope(req);res.json({success:true,data:await invoicerClient().overview(id)});}));
router.post('/connect',asyncHandler(async(req,res)=>{
  const id=scope(req,manage);
  const property=await Property.findById(id).select('name legalName taxNumber address city').lean();
  if(!property)throw Object.assign(new Error('הנכס לא נמצא'),{status:404});
  const client=invoicerClient();
  const existing=await client.findWorkspace(id);
  if(existing)return res.json({success:true,data:existing});
  const addr=typeof property.address==='string'?property.address:property.address?.line1;
  const input={legalName:req.body.legalName||property.legalName||property.name,taxId:String(req.body.taxId||property.taxNumber||'').replace(/\D/g,''),address:req.body.address||addr,city:req.body.city||property.city};
  res.json({success:true,data:await client.connectWorkspace(property,input)});
}));
router.post('/sync',asyncHandler(async(req,res)=>{const id=scope(req,manage);res.json({success:true,data:await syncInvoicerDocuments(id)});}));
export default router;

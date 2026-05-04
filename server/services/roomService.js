import Room from '../models/Room.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import MaintenanceTicket from '../models/MaintenanceTicket.js';
import { audit } from './auditService.js';

/**
 * Update room housekeeping status.
 * Enforces: dirty room needs HK task completion before clean.
 */
export async function updateCleanStatus({ roomId, cleanStatus, actorId, actorName, ip, propertyId }) {
  const room = await Room.findById(roomId);
  if (!room) throw new Error('חדר לא נמצא');
  const before = room.toObject();
  room.cleanStatus = cleanStatus;
  // When marking as clean/inspected — also update occStatus if vacant
  if (['clean','inspected'].includes(cleanStatus) && room.occStatus === 'checked_out') {
    room.occStatus = 'vacant';
  }
  await room.save();
  await audit({ property: propertyId, actor: actorId, actorName,
    action: `room.clean_status.${cleanStatus}`, entityType: 'Room', entityId: room._id, before, after: room.toObject(), ip });
  return room;
}

/**
 * Update room operational status (available, out_of_order, etc.)
 * OOO rooms update inventory.
 */
export async function updateOpsStatus({ roomId, opsStatus, reason, actorId, actorName, ip, propertyId }) {
  const room = await Room.findById(roomId);
  if (!room) throw new Error('חדר לא נמצא');
  const before = room.toObject();
  room.opsStatus = opsStatus;
  await room.save();
  await audit({ property: propertyId, actor: actorId, actorName,
    action: `room.ops_status.${opsStatus}`, entityType: 'Room', entityId: room._id,
    before, after: room.toObject(), reason, ip });
  return room;
}

/**
 * Complete a housekeeping task and transition room to clean/pending inspection.
 */
export async function completeHkTask({ taskId, actorId, actorName, ip, propertyId }) {
  const task = await HousekeepingTask.findById(taskId).populate('room');
  if (!task) throw new Error('משימה לא נמצאה');
  task.status = 'completed';
  task.completedAt = new Date();
  await task.save();

  // Room moves to pending inspection
  const room = task.room;
  if (room) {
    room.cleanStatus = 'pickup';
    await room.save();
  }

  await audit({ property: propertyId, actor: actorId, actorName,
    action: 'housekeeping.task_completed', entityType: 'HousekeepingTask', entityId: task._id,
    after: { status: 'completed' }, ip });

  return task;
}

/**
 * Inspector approves room — moves to clean.
 */
export async function inspectRoom({ taskId, approved, notes, actorId, actorName, ip, propertyId }) {
  const task = await HousekeepingTask.findById(taskId).populate('room');
  if (!task) throw new Error('משימה לא נמצאה');

  if (approved) {
    task.status = 'inspected';
    task.inspectedBy = actorId;
    task.inspectedAt = new Date();
    task.inspectionNotes = notes;
    await task.save();
    if (task.room) {
      await updateCleanStatus({ roomId: task.room._id, cleanStatus: 'inspected', actorId, actorName, ip, propertyId });
    }
  } else {
    // Failed inspection — back to new
    task.status = 'failed_inspection';
    task.inspectionNotes = notes;
    await task.save();
  }

  return task;
}

/**
 * Open/close a maintenance ticket and block/unblock room.
 */
export async function createMaintenanceTicket({ propertyId, roomId, category, description, priority, blocksRoom, actorId }) {
  const ticket = await MaintenanceTicket.create({
    property: propertyId, room: roomId, category, description, priority: priority || 'medium',
    status: 'new', blocksRoom: !!blocksRoom, reportedBy: actorId,
  });

  if (blocksRoom && roomId) {
    await Room.findByIdAndUpdate(roomId, { opsStatus: 'out_of_order' });
  }

  return ticket;
}

export async function resolveMaintenanceTicket({ ticketId, actorId, actorName, ip, propertyId }) {
  const ticket = await MaintenanceTicket.findById(ticketId).populate('room');
  if (!ticket) throw new Error('תקלה לא נמצאה');
  ticket.status = 'resolved';
  ticket.resolvedAt = new Date();
  await ticket.save();

  // Unblock room if it was blocked
  if (ticket.blocksRoom && ticket.room) {
    await Room.findByIdAndUpdate(ticket.room._id, { opsStatus: 'available' });
  }

  await audit({ property: propertyId, actor: actorId, actorName,
    action: 'maintenance.resolved', entityType: 'MaintenanceTicket', entityId: ticket._id,
    after: { status: 'resolved' }, ip });

  return ticket;
}

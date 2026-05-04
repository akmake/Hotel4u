import Room from '../models/Room.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import MaintenanceTicket from '../models/MaintenanceTicket.js';
import { audit } from './auditService.js';

/**
 * Update room housekeeping status.
 * Enforces: checked_out room can return to vacant only after clean/inspection.
 */
export async function updateCleanStatus({ roomId, cleanStatus, actorId, actorName, ip, propertyId }) {
  const room = await Room.findById(roomId);
  if (!room) throw new Error('Room not found');

  const before = room.toObject();
  room.cleanStatus = cleanStatus;

  if (['clean', 'inspected'].includes(cleanStatus) && room.occStatus === 'checked_out') {
    room.occStatus = 'vacant';
  }

  await room.save();

  await audit({
    property: propertyId,
    actor: actorId,
    actorName,
    action: `room.clean_status.${cleanStatus}`,
    entityType: 'Room',
    entityId: room._id,
    before,
    after: room.toObject(),
    ip,
  });

  return room;
}

/**
 * Update room operational status (available, out_of_order, etc.).
 */
export async function updateOpsStatus({ roomId, opsStatus, outOfServiceUntil, reason, actorId, actorName, ip, propertyId }) {
  const room = await Room.findById(roomId);
  if (!room) throw new Error('Room not found');

  const before = room.toObject();

  if (opsStatus === 'available') {
    const hasCriticalBlockingTicket = await MaintenanceTicket.exists({
      room: room._id,
      priority: 'critical',
      blocksRoom: true,
      status: { $nin: ['resolved', 'verified', 'closed'] },
    });

    if (hasCriticalBlockingTicket) {
      throw new Error('Cannot set room to available while critical blocking maintenance is open');
    }
  }

  room.opsStatus = opsStatus;

  if (opsStatus === 'out_of_service') {
    room.outOfServiceUntil = outOfServiceUntil || room.outOfServiceUntil;
  } else {
    room.outOfServiceUntil = undefined;
  }

  await room.save();

  await audit({
    property: propertyId,
    actor: actorId,
    actorName,
    action: `room.ops_status.${opsStatus}`,
    entityType: 'Room',
    entityId: room._id,
    before,
    after: room.toObject(),
    reason,
    ip,
  });

  return room;
}

/**
 * Complete a housekeeping task and transition room to pending inspection.
 */
export async function completeHkTask({ taskId, actorId, actorName, ip, propertyId }) {
  const task = await HousekeepingTask.findById(taskId).populate('room');
  if (!task) throw new Error('Task not found');

  task.status = 'completed';
  task.completedAt = new Date();
  await task.save();

  const room = task.room;
  if (room) {
    room.cleanStatus = 'pickup';
    await room.save();
  }

  await audit({
    property: propertyId,
    actor: actorId,
    actorName,
    action: 'housekeeping.task_completed',
    entityType: 'HousekeepingTask',
    entityId: task._id,
    after: { status: 'completed' },
    ip,
  });

  return task;
}

/**
 * Inspector approves room and moves it to inspected.
 */
export async function inspectRoom({ taskId, approved, notes, actorId, actorName, ip, propertyId }) {
  const task = await HousekeepingTask.findById(taskId).populate('room');
  if (!task) throw new Error('Task not found');

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
    task.status = 'failed_inspection';
    task.inspectionNotes = notes;
    await task.save();
  }

  return task;
}

/**
 * Open a maintenance ticket and optionally block room sales.
 */
export async function createMaintenanceTicket({ propertyId, roomId, category, description, priority, blocksRoom, actorId }) {
  const ticket = await MaintenanceTicket.create({
    property: propertyId,
    room: roomId,
    category,
    description,
    priority: priority || 'medium',
    status: 'new',
    blocksRoom: !!blocksRoom,
    reportedBy: actorId,
  });

  if (blocksRoom && roomId) {
    await Room.findByIdAndUpdate(roomId, { opsStatus: 'out_of_order', outOfServiceUntil: undefined });
  }

  return ticket;
}

export async function resolveMaintenanceTicket({ ticketId, actorId, actorName, ip, propertyId }) {
  const ticket = await MaintenanceTicket.findById(ticketId).populate('room');
  if (!ticket) throw new Error('Ticket not found');

  ticket.status = 'resolved';
  ticket.resolvedAt = new Date();
  await ticket.save();

  if (ticket.blocksRoom && ticket.room) {
    await Room.findByIdAndUpdate(ticket.room._id, { opsStatus: 'available', outOfServiceUntil: undefined });
  }

  await audit({
    property: propertyId,
    actor: actorId,
    actorName,
    action: 'maintenance.resolved',
    entityType: 'MaintenanceTicket',
    entityId: ticket._id,
    after: { status: 'resolved' },
    ip,
  });

  return ticket;
}

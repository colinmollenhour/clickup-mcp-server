/**
 * ClickUp MCP Task Operation Handlers
 * 
 * This module implements the handlers for task operations, both for single task
 * and bulk operations. These handlers are used by the tool definitions.
 */

import { ClickUpComment, ClickUpTask, TaskPriority, UpdateTaskData, TaskFilters, toTaskPriority } from '../../services/clickup/types.js';
import { clickUpServices } from '../../services/shared.js';
import { BulkService } from '../../services/clickup/bulk.js';
import { BatchResult } from '../../utils/concurrency-utils.js';
import { parseDueDate } from '../utils.js';
import { 
  validateTaskIdentification, 
  validateListIdentification,
  validateTaskUpdateData,
  validateBulkTasks,
  parseBulkOptions,
  resolveTaskIdWithValidation,
  resolveListIdWithValidation,
  formatTaskData
} from './utilities.js';

// Use shared services instance
const { task: taskService, list: listService } = clickUpServices;

// Create a bulk service instance that uses the task service
const bulkService = new BulkService(taskService);

//=============================================================================
// SHARED UTILITY FUNCTIONS
//=============================================================================

/**
 * Build task update data from parameters
 */
function buildUpdateData(params: any): UpdateTaskData {
  const updateData: UpdateTaskData = {};
  
  if (params.name !== undefined) updateData.name = params.name;
  if (params.description !== undefined) updateData.description = params.description;
  if (params.markdown_description !== undefined) updateData.markdown_description = params.markdown_description;
  if (params.status !== undefined) updateData.status = params.status;
  if (params.priority !== undefined) updateData.priority = toTaskPriority(params.priority);
  if (params.dueDate !== undefined) updateData.due_date = parseDueDate(params.dueDate);
  
  return updateData;
}

/**
 * Process a task identification validation, returning the task ID
 */
async function getTaskId(taskId?: string, taskName?: string, listName?: string, customTaskId?: string): Promise<string> {
  validateTaskIdentification(taskId, taskName, listName, customTaskId);
  return await resolveTaskIdWithValidation(taskId, taskName, listName, customTaskId);
}

/**
 * Process a list identification validation, returning the list ID
 */
async function getListId(listId?: string, listName?: string): Promise<string> {
  validateListIdentification(listId, listName);
  return await resolveListIdWithValidation(listId, listName);
}

/**
 * Extract and build task filters from parameters
 */
function buildTaskFilters(params: any): TaskFilters {
  const { subtasks, statuses, page, order_by, reverse } = params;
  const filters: TaskFilters = {};
  
  if (subtasks !== undefined) filters.subtasks = subtasks;
  if (statuses !== undefined) filters.statuses = statuses;
  if (page !== undefined) filters.page = page;
  if (order_by !== undefined) filters.order_by = order_by;
  if (reverse !== undefined) filters.reverse = reverse;
  
  return filters;
}

/**
 * Map tasks for bulk operations, resolving task IDs
 */
async function mapTaskIds(tasks: any[]): Promise<string[]> {
  return Promise.all(tasks.map(async (task) => {
    validateTaskIdentification(task.taskId, task.taskName, task.listName, task.customTaskId);
    return await resolveTaskIdWithValidation(task.taskId, task.taskName, task.listName, task.customTaskId);
  }));
}

//=============================================================================
// SINGLE TASK OPERATIONS
//=============================================================================

/**
 * Handler for creating a task
 */
export async function createTaskHandler(params) {
  const { name, description, markdown_description, status, dueDate } = params;
  
  if (!name) throw new Error("Task name is required");
  
  // Use our helper function to validate and convert priority
  const priority = toTaskPriority(params.priority);

  const listId = await getListId(params.listId, params.listName);
  
  return await taskService.createTask(listId, {
    name,
    description,
    markdown_description,
    status,
    priority,
    due_date: dueDate ? parseDueDate(dueDate) : undefined
  });
}

/**
 * Handler for updating a task
 */
export async function updateTaskHandler(params) {
  validateTaskUpdateData(params);
  const taskId = await getTaskId(params.taskId, params.taskName, params.listName);
  return await taskService.updateTask(taskId, buildUpdateData(params));
}

/**
 * Handler for moving a task
 */
export async function moveTaskHandler(params) {
  const taskId = await getTaskId(params.taskId, params.taskName, params.listName);
  const listId = await getListId(params.listId, params.listName);
  return await taskService.moveTask(taskId, listId);
}

/**
 * Handler for duplicating a task
 */
export async function duplicateTaskHandler(params) {
  const taskId = await getTaskId(params.taskId, params.taskName, params.listName);
  let listId;
  
  if (params.listId || params.listName) {
    listId = await getListId(params.listId, params.listName);
  }
  
  return await taskService.duplicateTask(taskId, listId);
}

/**
 * Handler for getting a task
 */
export async function getTaskHandler(params) {
  // resolveTaskIdWithValidation now auto-detects whether taskId is a regular ID or custom ID
  const taskId = await getTaskId(params.taskId, params.taskName, params.listName, params.customTaskId);
  return await taskService.getTask(taskId);
}

/**
 * Handler for getting tasks
 */
export async function getTasksHandler(params) {
  const listId = await getListId(params.listId, params.listName);
  return await taskService.getTasks(listId, buildTaskFilters(params));
}

/**
 * Handler for deleting a task
 */
export async function deleteTaskHandler(params) {
  const taskId = await getTaskId(params.taskId, params.taskName, params.listName);
  await taskService.deleteTask(taskId);
  return true;
}

/**
 * Handler for getting task comments
 */
export async function getTaskCommentsHandler(params) {
  const taskId = await getTaskId(params.taskId, params.taskName, params.listName);
  const { start, startId } = params;
  return await taskService.getTaskComments(taskId, start, startId);
}

/**
 * Handler for creating a task comment
 */
export async function createTaskCommentHandler(params) {
  // Validate required parameters
  if (!params.commentText) {
    throw new Error('Comment text is required');
  }
  
  try {
    // Resolve the task ID
    const taskId = await getTaskId(params.taskId, params.taskName, params.listName);
    
    // Extract other parameters with defaults
    const {
      commentText,
      notifyAll = false,
      assignee = null
    } = params;
    
    // Create the comment
    return await taskService.createTaskComment(taskId, commentText, notifyAll, assignee);
  } catch (error) {
    // If this is a task lookup error, provide more helpful message
    if (error.message?.includes('not found') || error.message?.includes('identify task')) {
      if (params.taskName) {
        throw new Error(`Could not find task "${params.taskName}" in list "${params.listName}"`);
      } else {
        throw new Error(`Task with ID "${params.taskId}" not found`);
      }
    }
    
    // Otherwise, rethrow the original error
    throw error;
  }
}

//=============================================================================
// BULK TASK OPERATIONS
//=============================================================================

/**
 * Handler for creating multiple tasks
 */
export async function createBulkTasksHandler(params) {
  validateBulkTasks(params.tasks);
  const listId = await getListId(params.listId, params.listName);
  
  // Process tasks - prepare data for each task
  const tasks = params.tasks.map(task => {
    const processedTask = { ...task };
    
    if (task.dueDate) {
      processedTask.due_date = parseDueDate(task.dueDate);
      delete processedTask.dueDate;
    }
    
    return processedTask;
  });

  const result = await bulkService.createTasks(
    listId, 
    tasks, 
    parseBulkOptions(params.options)
  );
  
  return result.successful;
}

/**
 * Handler for updating multiple tasks
 */
export async function updateBulkTasksHandler(params) {
  validateBulkTasks(params.tasks);
  
  const updates = await Promise.all(params.tasks.map(async (task) => {
    validateTaskUpdateData(task);
    const taskId = await getTaskId(task.taskId, task.taskName, task.listName);
    return { id: taskId, data: buildUpdateData(task) };
  }));

  const result = await bulkService.updateTasks(
    updates, 
    parseBulkOptions(params.options)
  );
  
  return result.successful;
}

/**
 * Handler for moving multiple tasks
 */
export async function moveBulkTasksHandler(params) {
  validateBulkTasks(params.tasks);
  
  if (!params.targetListId && !params.targetListName) {
    throw new Error("Either targetListId or targetListName must be provided");
  }

  const targetListId = await getListId(params.targetListId, params.targetListName);
  const taskIds = await mapTaskIds(params.tasks);
  
  const result = await bulkService.moveTasks(
    taskIds, 
    targetListId, 
    parseBulkOptions(params.options)
  );
  
  return result.successful;
}

/**
 * Handler for deleting multiple tasks
 */
export async function deleteBulkTasksHandler(params) {
  validateBulkTasks(params.tasks);
  const taskIds = await mapTaskIds(params.tasks);
  
  await bulkService.deleteTasks(
    taskIds, 
    parseBulkOptions(params.options)
  );
  
  return taskIds.map(() => true);
} 
export type Status = 'open' | 'in_progress' | 'done' | 'blocked';
export type Priority = 'low' | 'medium' | 'high';

export const STATUSES: Status[] = ['open', 'in_progress', 'done', 'blocked'];
export const PRIORITIES: Priority[] = ['low', 'medium', 'high'];

export interface User {
  id: number;
  name: string;
  email: string;
  createdAt: string;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  ownerId: number;
}

export interface Ticket {
  id: number;
  title: string;
  description: string;
  projectId: number;
  assigneeId: number | null;
  status: Status;
  priority: Priority;
  dueDate: string | null;
  createdAt: string;
}

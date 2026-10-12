export const STATUS = {
  pending: { label: "Not sent", cls: "pending" },
  sent: { label: "Sent · awaiting reply", cls: "sent" },
  accepted: { label: "Accepted", cls: "accepted" },
  in_progress: { label: "In progress", cls: "in_progress" },
  done: { label: "Done", cls: "done" },
  extension_requested: { label: "Extension requested", cls: "extension" },
  issue_reported: { label: "Issue reported", cls: "issue" },
  overdue: { label: "Overdue", cls: "overdue" },
};

export function isOverdue(task) {
  if (task.status === "done" || !task.due_date) return false;
  return new Date(task.due_date) < new Date();
}

export function effectiveStatus(task) {
  return isOverdue(task) ? "overdue" : task.status;
}

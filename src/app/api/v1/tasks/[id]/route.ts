import { createItemHandlers } from "@/lib/utils/crud-helpers";

const taskFields = [
  "title", "description", "subject_domain", "challenge_type",
  "content", "grade_range_min", "grade_range_max",
  "difficulty_level", "feedback", "is_library",
];

export const { GET, PUT, DELETE } = createItemHandlers("tasks", {
  allowedUpdateFields: taskFields,
  textFields: ["title", "description", "content", "feedback"],
});

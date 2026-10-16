import { createItemHandlers } from "@/lib/utils/crud-helpers";

const primerFields = [
  "title", "content", "subject_domain",
  "grade_range_min", "grade_range_max", "is_library",
];

export const { GET, PUT, DELETE } = createItemHandlers("primers", {
  allowedUpdateFields: primerFields,
  textFields: ["title", "content"],
});

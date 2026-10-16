import { Clock, CheckCircle2, XCircle } from "lucide-react";

interface ReviewStatusNoticeProps {
  status: string;
  reviewStatus?: string | null;
  reason?: string | null;
}

/**
 * Where a published hunt stands in publish review (migration 073), shown to
 * its creator. Drafts and never-submitted hunts show nothing.
 */
export function ReviewStatusNotice({ status, reviewStatus, reason }: ReviewStatusNoticeProps) {
  if (status === "draft" || !reviewStatus || reviewStatus === "not_submitted") return null;

  if (reviewStatus === "pending") {
    return (
      <div role="status" className="mb-4 flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
        <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          <strong>Waiting for review.</strong> You and students on your class rosters can play it now
          from its link. It will appear in Discover once a reviewer approves it, and you&apos;ll get a
          notification either way.
        </p>
      </div>
    );
  }

  if (reviewStatus === "rejected") {
    return (
      <div role="status" className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div>
          <p>
            <strong>Not approved.</strong> Until a reviewer approves it, only you can open it: it
            isn&apos;t listed publicly, and your students can&apos;t play it.
          </p>
          {reason && <p className="mt-1 break-words">Reviewer note: {reason}</p>}
          <p className="mt-1">To resubmit, unpublish it, make your changes, and submit it for review again.</p>
        </div>
      </div>
    );
  }

  return (
    <div role="status" className="mb-4 flex items-start gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>
        <strong>Approved and listed in Discover.</strong> Changing its text or stops sends it back for review.
      </p>
    </div>
  );
}

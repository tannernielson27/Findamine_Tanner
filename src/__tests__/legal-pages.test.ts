import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PrivacyPolicyPage from "@/app/privacy/page";
import TermsOfUsePage from "@/app/terms/page";
import { CONTACT_EMAIL, LAST_UPDATED, formatLegalDate } from "@/lib/constants/legal";

const privacyHtml = renderToStaticMarkup(createElement(PrivacyPolicyPage));
const termsHtml = renderToStaticMarkup(createElement(TermsOfUsePage));

describe("formatLegalDate", () => {
  it("formats an ISO date without timezone drift", () => {
    expect(formatLegalDate("2026-10-15")).toBe("October 15, 2026");
  });

  it("returns the input unchanged when it is not a date", () => {
    expect(formatLegalDate("not-a-date")).toBe("not-a-date");
  });
});

describe.each([
  ["privacy", privacyHtml],
  ["terms", termsHtml],
])("%s page", (_name, html) => {
  it("shows the contact address and last-updated date", () => {
    expect(html).toContain(`mailto:${CONTACT_EMAIL}`);
    expect(html).toContain(`dateTime="${LAST_UPDATED}"`);
  });

  it("links to both legal pages", () => {
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
  });

  it("does not claim the app is operated by the university", () => {
    expect(html).not.toMatch(/developed by Brigham Young/i);
    expect(html).not.toMatch(/ages 7-15/i);
  });
});

describe("privacy policy content", () => {
  it("covers the disclosures App Review and COPPA need", () => {
    expect(privacyHtml).toContain("Settings → Delete account");
    expect(privacyHtml).toContain("COPPA");
    expect(privacyHtml).toMatch(/do not sell/i);
    for (const provider of ["Supabase", "Vercel", "Anthropic", "OpenAI", "Google Maps", "Resend", "Upstash"]) {
      expect(privacyHtml).toContain(provider);
    }
  });

  it("says spoken answers are uploaded privately, except on children's accounts", () => {
    expect(privacyHtml).not.toMatch(/The recording stays on your device/);
    expect(privacyHtml).toMatch(/Recordings from teen and adult\s+accounts are uploaded to private storage/);
    expect(privacyHtml).toMatch(/Recordings\s+made on children&#x27;s accounts \(under 13\) stay on the device/);
  });
});

/** Collapse the source line breaks so phrases can be matched across them. */
const flat = (html: string) => html.replace(/\s+/g, " ");
const privacy = flat(privacyHtml);
const terms = flat(termsHtml);

describe("privacy policy: features added since the first draft", () => {
  it("does not store children's precise location", () => {
    expect(privacy).not.toMatch(/For all photo challenges we record the time and the location/);
    expect(privacy).not.toMatch(/arrival locations at hunt stops/);
    expect(privacy).toMatch(/how far from it they were \(not their precise location\)/);
    expect(privacy).toMatch(/does not store the child&#x27;s coordinates/);
    expect(privacy).toMatch(/Children never upload photos or recordings/);
  });

  it("describes blocking", () => {
    expect(privacy).toContain("Settings → Blocked players");
    expect(privacy).toMatch(/neither of you sees the other&#x27;s chat messages, kudos, wall posts or shoutouts/);
    expect(privacy).toMatch(/any friendship between you is removed/);
  });

  it("describes reports, their content snapshot and the admin alert", () => {
    expect(privacy).toMatch(/a copy of its text/);
    expect(privacy).toMatch(/Only Findamine administrators can see reports/);
    expect(privacy).toMatch(/contains no reported content and no names/);
  });

  it("describes the content filter", () => {
    expect(privacy).toMatch(/display names, team names and hunt text\) is checked automatically/);
  });

  it("describes non-participant privacy defaults instead of 'may be visible to everyone'", () => {
    expect(privacy).not.toMatch(/it may be visible to everyone/);
    expect(privacy).toMatch(/nothing is shown to everyone/);
  });

  it("describes the date-of-birth requirement and participant-only study rules", () => {
    expect(privacy).not.toMatch(/confirm in the consent screen that you are 18 or older/);
    expect(privacy).toMatch(/consent screen asks for your date of birth before you can join/);
    expect(privacy).toMatch(/use it only to confirm that you are 18 or older/);
    expect(privacy).toMatch(/These study rules apply only to participants/);
  });

  it("records the safety notice acknowledgement", () => {
    expect(privacy).toMatch(/acknowledged the safety notice/);
  });

  it("says catalogue listing happens after review", () => {
    expect(privacy).toMatch(/public hunt catalogue once a Findamine reviewer has approved them/);
  });

  it("describes what account deletion deletes, de-identifies and keeps", () => {
    expect(privacy).toMatch(/placeholder named &quot;Deleted user&quot;/);
    expect(privacy).toMatch(/Keep reports about your content<\/strong>, including the copy of the reported content/);
    expect(privacy).toMatch(/Keep de-identified research records/);
    expect(privacy).toMatch(/reduced to the date, the version and whether consent was given/);
    expect(privacy).toMatch(/the child and teen accounts you created are deleted/);
  });
});

describe("terms of use content", () => {
  it("states zero tolerance for objectionable content and how to report it", () => {
    expect(termsHtml).toMatch(/zero tolerance for objectionable content and abusive users/i);
    expect(termsHtml).toMatch(/report/i);
    expect(termsHtml).toMatch(/private property/i);
  });

  it("lists where reporting is available and that admins review reports", () => {
    expect(terms).toMatch(/chat messages, kudos, player profiles and hunt stops/);
    expect(terms).toMatch(/Reports are reviewed by Findamine administrators/);
  });

  it("describes blocking, the content filter and connected-only kudos", () => {
    expect(terms).toContain("Settings → Blocked players");
    expect(terms).toMatch(/refuses text that contains objectionable words/);
    expect(terms).toMatch(/Kudos can only be sent to people you are connected with/);
  });

  it("describes hunt review for creators", () => {
    expect(terms).toMatch(/We record that you confirmed this, and when/);
    expect(terms).toMatch(/goes into a review queue/);
    expect(terms).toMatch(/it leaves the catalogue and goes back for review/);
  });

  it("explains that shared content survives account deletion and parent deletion covers children", () => {
    expect(terms).toMatch(/shown as by &quot;Deleted user&quot;/);
    expect(terms).toMatch(/also deletes the child and teen accounts you created/);
  });
});

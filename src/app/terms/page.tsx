import type { Metadata } from "next";
import Link from "next/link";
import LegalPage, { ContactEmail, LegalSection } from "@/components/legal/legal-page";
import { OPERATOR_NAME, PRIVACY_PATH } from "@/lib/constants/legal";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "The rules for playing Findamine, posting content, and staying safe outdoors.",
};

const SECTIONS = [
  { id: "agreement", title: "Agreeing to these terms" },
  { id: "accounts", title: "Accounts and age" },
  { id: "safety", title: "Play safely and lawfully" },
  { id: "conduct", title: "Community rules" },
  { id: "content", title: "Your content" },
  { id: "moderation", title: "Reporting and moderation" },
  { id: "research", title: "Research participation" },
  { id: "ending", title: "Ending your account" },
  { id: "disclaimers", title: "Disclaimers" },
  { id: "liability", title: "Limitation of liability" },
  { id: "changes", title: "Changes" },
  { id: "contact", title: "Contact us" },
] as const;

export default function TermsOfUsePage() {
  const linkClass = "text-brand hover:underline";
  return (
    <LegalPage
      title="Terms of Use"
      sections={SECTIONS}
      intro={
        <p>
          These terms are the rules for using {OPERATOR_NAME}, a free location-based game where you
          follow clues to real places and complete challenges. We have tried to keep them short and
          in plain language.
        </p>
      }
    >
      <LegalSection id="agreement" title="1. Agreeing to these terms">
        <p>By creating an account or using {OPERATOR_NAME} you agree to these Terms of Use and to
          our <Link href={PRIVACY_PATH} className={linkClass}>Privacy Policy</Link>, which explains
          how we handle your information. If you do not agree, please do not use the app.</p>
      </LegalSection>

      <LegalSection id="accounts" title="2. Accounts and age">
        <ul>
          <li>You must be at least 13 to create your own account. Teens (13 to 17) should have a
            parent or guardian&apos;s permission.</li>
          <li>Accounts for children under 13 can be created only by a parent or teacher, and stay
            inactive until that adult gives consent. The adult is responsible for supervising the
            child&apos;s use of the app.</li>
          <li>Give accurate information when you sign up, keep your password private, and tell us
            if you think someone else is using your account. You are responsible for what happens
            under your account.</li>
          <li>One person per account. Do not impersonate anyone.</li>
        </ul>
      </LegalSection>

      <LegalSection id="safety" title="3. Play safely and lawfully">
        <p>{OPERATOR_NAME} sends you to real places. Your safety is your responsibility, and
          a hunt is never a reason to take a risk.</p>
        <ul>
          <li><strong>Stay aware of your surroundings.</strong> Do not look at your screen while
            walking near traffic, crossing streets, cycling, or driving. Never use the app while
            driving.</li>
          <li><strong>Do not trespass.</strong> Stay on public land or places you have permission
            to be. Do not enter private property, closed areas, or restricted buildings, even if a
            clue seems to point there.</li>
          <li><strong>Obey all laws</strong>, posted signs, park rules, and instructions from
            property owners, staff and police.</li>
          <li><strong>Avoid danger.</strong> Skip any stop that is unsafe, for example because of
            weather, darkness, water, cliffs, construction or traffic.</li>
          <li><strong>Children</strong> should play with a parent, teacher or other responsible
            adult.</li>
          <li>Hunt creators must place stops only in places that are public, safe and legal to
            visit (see section 5 for how hunts are reviewed).</li>
        </ul>
      </LegalSection>

      <LegalSection id="conduct" title="4. Community rules">
        <p><strong>We have zero tolerance for objectionable content and abusive users.</strong> You
          may not post, send or create anything that:</p>
        <ul>
          <li>harasses, bullies, threatens, stalks or intimidates anyone;</li>
          <li>is hateful or discriminatory, or attacks people for who they are;</li>
          <li>is sexual, sexually suggestive, pornographic, or exploits or endangers children in
            any way;</li>
          <li>is violent or graphic, or encourages self-harm, dangerous acts or illegal
            activity;</li>
          <li>shares someone else&apos;s personal information, such as their address, phone number,
            school or location, or photos of people without their permission;</li>
          <li>is spam, a scam, advertising, or malware; or</li>
          <li>infringes someone else&apos;s copyright, trademark or other rights.</li>
        </ul>
        <p>Also do not cheat by faking your location, use bots or scripts, try to get into other
          people&apos;s accounts, or interfere with the app or its security.</p>
        <p>To help enforce these rules, the app automatically checks the text you enter (chat
          messages, kudos, shoutouts, wall posts, hunt reviews, display names, team names and hunt
          text) and refuses text that contains objectionable words. The check is stricter on
          children&apos;s accounts. It will not catch everything, so the rules above still apply to
          anything it lets through.</p>
      </LegalSection>

      <LegalSection id="content" title="5. Your content">
        <p>You own what you create and post, such as messages, photos, reviews and hunts. By
          posting it you give {OPERATOR_NAME} permission to store, display and share it within the
          app, to the people you post it to, so the game can work. For hunts you publish, that
          includes showing them in the public hunt catalogue. This permission ends when you delete
          the content, except for copies other people have already received or that we must keep
          for legal or safety reasons (such as a copy of reported content). Deleting your account
          deletes your personal posts, but hunts and other content you made for other people stay
          in the app, shown as by &quot;Deleted user&quot;, unless you delete them first; see section
          8 of the <Link href={PRIVACY_PATH} className={linkClass}>Privacy Policy</Link>.</p>
        <p>Only post content you have the right to share.</p>
        <p><strong>Publishing hunts.</strong> If you create hunts:</p>
        <ul>
          <li>When you publish a hunt you must confirm that it is safe and appropriate for its
            audience: every stop is in a public place that is safe and legal to visit, and nothing
            in it breaks section 4. We record that you confirmed this, and when.</li>
          <li>A published hunt goes into a review queue. It appears in the public hunt catalogue
            only after a Findamine reviewer approves it. Until then you, reviewers, and students on
            your class rosters can still play it. A reviewer may reject a hunt and tell you
            why. A rejected hunt can only be opened by you and reviewers until you fix it and
            submit it again.</li>
          <li>If you change an approved hunt (for example its title, description, clues, hints,
            challenges or places), it leaves the catalogue and goes back for review.</li>
          <li>Reviewers do not visit every location, so you remain responsible for your
            hunt&apos;s content and for the places it sends people.</li>
        </ul>
      </LegalSection>

      <LegalSection id="moderation" title="6. Reporting and moderation">
        <ul>
          <li>If you see content or behavior that breaks these rules, report it with the Report
            option in the app, which is available on chat messages, kudos, player profiles and
            hunt stops, or email us at <ContactEmail />. A report keeps a copy of the reported
            text where it can, so it can be reviewed even if the original is changed or
            deleted.</li>
          <li>You can <strong>block</strong> any player from their profile and manage your blocks
            in <strong>Settings → Blocked players</strong>. Blocking works both ways: neither of
            you sees the other&apos;s chat messages, kudos, wall posts or shoutouts, neither can
            send the other kudos, shoutouts or friend requests, and any friendship between you is
            removed. The other player is not told.</li>
          <li>Kudos can only be sent to people you are connected with: friends, teammates,
            classmates, or a recruiter and the player they invited.</li>
          <li>Reports are reviewed by Findamine administrators, normally within 24 hours. We may
            remove content and warn, suspend or permanently ban the user who posted it. Removed
            content is hidden from everyone.</li>
          <li>We may also remove content or restrict accounts on our own initiative, including
            when our automated systems detect spam or abuse.</li>
          <li>If you believe your content was removed by mistake, contact us.</li>
        </ul>
      </LegalSection>

      <LegalSection id="research" title="7. Research participation">
        <p>{OPERATOR_NAME} is being used in a student honors research project at Brigham Young
          University. Taking part is completely voluntary, is open only to adults (18 or older),
          and requires your separate consent in the app. If your account has no date of birth, the
          consent screen asks for it before you can join; it is used only to confirm that you are
          18 or older. Saying no will not affect your grade,
          your standing in any class, or how you can use {OPERATOR_NAME}, and you can withdraw at
          any time. See section 5 of the <Link href={PRIVACY_PATH} className={linkClass}>Privacy
          Policy</Link> for details.</p>
      </LegalSection>

      <LegalSection id="ending" title="8. Ending your account">
        <p>You can stop using {OPERATOR_NAME} at any time and delete your account in the app from
          <strong> Settings → Delete account</strong>. Deletion cannot be undone. If you are a
          parent, deleting your account also deletes the child and teen accounts you created.
          Section 8 of the <Link href={PRIVACY_PATH} className={linkClass}>Privacy Policy</Link>{" "}
          explains what is deleted and the few records that are kept. We may suspend or close
          accounts that break these terms, put other people at risk, or that we are required to
          close by law.</p>
      </LegalSection>

      <LegalSection id="disclaimers" title="9. Disclaimers">
        <p>{OPERATOR_NAME} is provided free and &quot;as is&quot;. We do our best, but we cannot
          promise the app will always be available or error-free, or that location information,
          maps, clues or user-created hunts are accurate, current, or safe to visit. Hunts are
          often created by other users, and we do not inspect every location. Places change; use
          your own judgment.</p>
      </LegalSection>

      <LegalSection id="liability" title="10. Limitation of liability">
        <p>To the fullest extent the law allows, {OPERATOR_NAME} is not liable for any injury,
          loss or damage arising from your use of the app, your visits to hunt locations, or other
          users&apos; content or conduct. Some places do not allow these limits, so they may not all
          apply to you; nothing in these terms limits rights you have that cannot be waived.</p>
      </LegalSection>

      <LegalSection id="changes" title="11. Changes">
        <p>We may update these terms as the app changes. We will update the date at the top of this
          page and, for significant changes, let you know in the app. Continuing to use
          {" "}{OPERATOR_NAME} after a change means you accept the updated terms.</p>
      </LegalSection>

      <LegalSection id="contact" title="12. Contact us">
        <p>Questions about these terms, or something to report: <ContactEmail />.</p>
      </LegalSection>
    </LegalPage>
  );
}

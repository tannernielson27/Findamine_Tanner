import type { Metadata } from "next";
import Link from "next/link";
import LegalPage, { ContactEmail, LegalSection } from "@/components/legal/legal-page";
import { OPERATOR_LEGAL_NAME, OPERATOR_NAME, SITE_DOMAIN, TERMS_PATH } from "@/lib/constants/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What Findamine collects, why, who it is shared with, and the choices you have.",
};

/**
 * Every statement below was checked against the code (see the PR notes for
 * the file each one comes from). If a feature changes what it collects or who
 * receives it, update this page and LAST_UPDATED in lib/constants/legal.ts.
 */
const SECTIONS = [
  { id: "collect", title: "What we collect" },
  { id: "use", title: "How we use it" },
  { id: "visible", title: "What other people can see" },
  { id: "sharing", title: "Service providers we use" },
  { id: "research", title: "The research study" },
  { id: "children", title: "Children and teens" },
  { id: "choices", title: "Your choices and rights" },
  { id: "retention", title: "How long we keep data" },
  { id: "security", title: "Security" },
  { id: "changes", title: "Changes to this policy" },
  { id: "contact", title: "Contact us" },
] as const;

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      sections={SECTIONS}
      intro={
        <>
          <p>
            {OPERATOR_NAME} ({SITE_DOMAIN}) is a location-based game: you follow clues to real places,
            complete challenges there, and earn points alone or with a team. This policy explains what
            information the {OPERATOR_NAME} app and website collect, why, who else handles it, and the
            choices you have. {OPERATOR_NAME} is run by {OPERATOR_LEGAL_NAME}, who is responsible
            for your information; &quot;we&quot; in this policy means {OPERATOR_LEGAL_NAME}.
          </p>
          <p>
            <strong>The short version:</strong> we collect what the game needs to work. We do not sell
            your data, we do not show ads, and we do not use third-party advertising or analytics
            trackers.
          </p>
        </>
      }
    >
      <LegalSection id="collect" title="1. What we collect">
        <p><strong>Account information.</strong> Your email address, a password (stored by our
          authentication provider, never in readable form), the display name you choose, and your
          account type (adult, teen, parent, teacher or hunt creator). Teen and adult accounts also
          give a date of birth so we can confirm the person&apos;s age. Parent, teacher and
          hunt-creator accounts do not give a date of birth when they sign up; they are asked for
          one only if they choose to join the research study, and it is used only to confirm they
          are 18 or older.</p>
        <p><strong>Profile information.</strong> Anything you add to your profile, such as an avatar
          or real name, along with game information shown on it: badges, total score, hunt history,
          friends, and personality-assessment results (such as Big Five and growth-mindset
          scores) if you complete those assessments. Personality results can be used to form
          balanced teams. You decide who can see each
          of these (see section 3).</p>
        <p><strong>Location.</strong> While you are playing a hunt, the app uses your device&apos;s
          precise location (with your permission) to guide you and to check that you reached each
          stop. Your position is sent to our servers while you navigate, but we only store the
          location at which you arrived at a stop, linked to that play session. For children&apos;s
          accounts (under 13) we do not store even that: we keep only the fact that the child
          arrived and how far from the stop they were. The app does not
          track your location when you are not playing a hunt. On the website&apos;s home page we
          also use the approximate region that our hosting provider derives from your internet
          connection to pick a background picture; that is not stored.</p>
        <p><strong>Photos.</strong> Some challenges ask for a photo, such as a selfie at a stop.
          Photos from teen and adult accounts are uploaded to private storage that is not publicly
          accessible. Photos taken on children&apos;s accounts (under 13) stay on the device and are
          not uploaded. For photos from teen and adult accounts we record the time and the location
          where the photo was taken. For children&apos;s photos we record only that a photo was
          taken and when; where it was taken is not stored.</p>
        <p><strong>Audio.</strong> Some challenges let you record a short spoken answer using your
          microphone (with your permission), up to two minutes long. Recordings from teen and adult
          accounts are uploaded to private storage that is not publicly accessible, along with how
          long the recording is. Only you and Findamine administrators (for example, when
          investigating a report) can play it back, through a link that expires after a few
          minutes. Recordings are not sent to AI services or used to score your answer. Recordings
          made on children&apos;s accounts (under 13) stay on the device and are not uploaded; we
          only record that an audio answer was given and how long it was.</p>
        <p><strong>Things you post.</strong> Team chat messages, kudos and shoutouts, social-wall
          posts, hunt reviews, team names, and, if you create hunts, the hunts, stops and clues you
          publish. If you submit a hunt for the public catalogue, we also record that you confirmed
          it is safe for its audience, and when.</p>
        <p><strong>Blocks and reports.</strong> If you block someone, we store who you blocked and
          when. If you report something, we store the report, the reason you chose, any comment you
          add and, where it can be looked up, who posted the reported item and a copy of its text
          (such as the chat message, kudos, profile name or hunt title, up to 1,000 characters), so
          a moderator can review it even if the original is later changed or deleted. Reports about you are handled the same way. Only Findamine
          administrators can see reports. When a report comes in, they get an email alert that
          says only what kind of item was reported and why; it contains no reported content and
          no names.</p>
        <p><strong>Gameplay.</strong> Hunts started and finished, answers to challenges, hints used,
          points, badges, leaderboard standing, and team membership.</p>
        <p><strong>How you use the app.</strong> We record events inside the app, such as pages
          visited, buttons used and settings changed, in our own database. This is first-party
          only; we do not use outside analytics services. We also store, with your account, that
          you acknowledged the safety notice shown before your first hunt, which version you saw,
          and when.</p>
        <p><strong>Security and abuse-prevention data.</strong> When you use the app our servers
          receive your IP address and browser or device type. We use them to limit request rates,
          to detect automated or abusive traffic, and to block it. Where we store an IP address for
          blocking, we store a scrambled (hashed) form rather than the address itself. We record
          the IP address alongside consent records (for example, when a parent gives consent) as
          evidence of when and how consent was given.</p>
        <p><strong>Survey answers.</strong> If you take part in the research study (section 5), the
          answers you give in its questionnaires.</p>
      </LegalSection>

      <LegalSection id="use" title="2. How we use it">
        <ul>
          <li>To run the game: show hunts, check arrivals and answers, keep score, and run teams,
            chat and leaderboards.</li>
          <li>To manage your account, sign you in, and send account email such as verification,
            password-reset and parental-consent messages. We do not send marketing email.</li>
          <li>To keep the community safe: review reports, moderate posts, enforce blocks, review
            hunts before they are listed publicly, and detect spam, bots and abuse. Text you enter
            (chat, kudos, shoutouts, wall posts, reviews, display names, team names and hunt text)
            is checked automatically, and text containing objectionable words is refused before it
            is posted; the check is stricter for children&apos;s accounts. Some abuse detection
            uses automated scoring of activity patterns, such as request rates and unusual
            traffic.</li>
          <li>To understand and improve the app, using the first-party usage events described
            above.</li>
          <li>For the research study, only for people who agree to take part (section 5).</li>
          <li>To meet legal obligations and enforce our <Link href={TERMS_PATH} className="text-brand hover:underline">Terms of Use</Link>.</li>
        </ul>
        <p>We do not sell personal information, share it for advertising, or use it to track you
          across other companies&apos; apps or websites.</p>
      </LegalSection>

      <LegalSection id="visible" title="3. What other people can see">
        <p>Findamine is social, so some things you do are visible to other players:</p>
        <ul>
          <li>Your display name and avatar appear on teams, chats and leaderboards.</li>
          <li>Messages, kudos, shoutouts, wall posts and reviews you post are visible to the people
            they are posted to (your team, class or the wider community).</li>
          <li>Kudos can only be sent between people who are connected: friends, teammates,
            classmates, or a recruiter and the player they invited.</li>
          <li>Hunts you publish appear in the public hunt catalogue once a Findamine reviewer has
            approved them. Until then only you, reviewers, and students on your class rosters can
            see them.</li>
        </ul>
        <p><strong>Blocking.</strong> You can block another player from their profile and manage
          your blocks in <strong>Settings → Blocked players</strong>. Once you block someone,
          neither of you sees the other&apos;s chat messages, kudos, wall posts or shoutouts; they
          cannot send you kudos, shoutouts or friend requests; and any friendship between you is
          removed. They are not told that you blocked them. When you report a chat message or
          kudos, it is also hidden from you straight away.</p>
        <p>For profile details (display name, avatar, real name, personality results, badges,
          total score, hunt history and friends list) you choose who can see each one: nobody, your
          team, your class, or everyone. You can change this at any time in <strong>Settings →
          Privacy</strong>. If you are not taking part in the research study, your profile starts
          out private-leaning: nothing is shown to everyone, and your real name and personality
          results are shown to nobody, until you change them. If you take part in the study, your
          starting settings are set as part of the study (section 5) and some may be visible to
          everyone, so please check them.</p>
      </LegalSection>

      <LegalSection id="sharing" title="4. Service providers we use">
        <p>We share information only with companies that provide services to run Findamine, only
          as needed for that service, and they may not use it for their own purposes:</p>
        <ul>
          <li><strong>Supabase</strong>: database, sign-in, and private file storage.</li>
          <li><strong>Vercel</strong>: hosting for the app and website.</li>
          <li><strong>Upstash</strong>: request rate limiting (handles IP addresses and account
            identifiers for that purpose).</li>
          <li><strong>Resend</strong>: sending account and consent emails.</li>
          <li><strong>Google Maps</strong>: displaying maps. When a map loads, Google receives the
            map area being shown and standard connection information such as your IP address.</li>
          <li><strong>Anthropic and OpenAI</strong>: AI features that help hunt creators write
            hunt content, clues and hints. These receive hunt and challenge text. We do not send
            them your location, photos, audio, email address or contact details.</li>
          <li><strong>Video hosts</strong>: some hunts include videos embedded from services such
            as YouTube or Vimeo. When you play one, that service receives standard connection
            information under its own privacy policy.</li>
        </ul>
        <p>We may also disclose information if required by law, to protect someone&apos;s safety,
          or to investigate abuse of the service.</p>
      </LegalSection>

      <LegalSection id="research" title="5. The research study">
        <p>Findamine is being used in a student honors research project at Brigham Young
          University about how people manage privacy settings in an app. Findamine itself is not
          operated by the university.</p>
        <ul>
          <li><strong>Only adults (18 or older) can take part</strong>, and only if they say yes in
            the consent screen shown in the app. Children, teens and Findamine staff are never
            invited. If your account has no date of birth (parent, teacher and hunt-creator
            accounts), the consent screen asks for your date of birth before you can join. We
            save it to your account and use it only to confirm that you are 18 or older; if it
            shows you are under 18, you are not enrolled and nothing is saved. Saying no does not
            change how you can use Findamine.</li>
          <li>If you take part, the study uses how you use the privacy settings (what you change
            and when), your general activity such as hunts played and points earned, and your
            answers to three short questionnaires.</li>
          <li>Participants may see different versions of some features, such as how privacy
            settings are laid out or set by default, or whether referral rewards depend on what
            your profile shows. These study rules apply only to participants. The study&apos;s
            debrief explains this in full.</li>
          <li>Study data is used only for the research and is reported for the group as a whole,
            never in a way that identifies you.</li>
          <li>You can withdraw at any time from the study debrief page in the app, or by contacting
            us. Study data collection stops from that point.</li>
        </ul>
        <p>If you do not consent, no study data is collected about you.</p>
      </LegalSection>

      <LegalSection id="children" title="6. Children and teens">
        <p><strong>Under 13.</strong> Children under 13 cannot sign up on their own. A parent or
          teacher creates the child&apos;s account. The account stays inactive until the adult who
          created it confirms consent through a link sent to their email address, as required by
          the U.S. Children&apos;s Online Privacy Protection Act (COPPA).</p>
        <p>For a child&apos;s account we collect the display name and date of birth the adult
          provides (an email address is optional), the child&apos;s gameplay, the fact that the
          child arrived at a hunt stop and how far from it they were (not their precise location),
          the fact and time that a photo was taken (the photo and where it was taken stay on the
          device), the length of any spoken answer (the recording itself stays on the device), and
          anything the child posts in team features. The app uses the device&apos;s location while
          the child plays to check arrival, but does not store the child&apos;s coordinates.
          Children never upload photos or recordings, and are not invited to take part in the
          research study.</p>
        <p>A parent can at any time ask us to show them the personal information we hold about
          their child, ask us to delete it, or withdraw consent so that we stop collecting it. Email
          us at <ContactEmail /> from the address on the parent account. We will not make a child
          give more information than a game activity reasonably needs. When a parent deletes their
          own account, the child and teen accounts that parent created are deleted with it (see
          section 8).</p>
        <p><strong>Teens (13 to 17)</strong> can create their own accounts. They are not eligible
          for the research study.</p>
      </LegalSection>

      <LegalSection id="choices" title="7. Your choices and rights">
        <ul>
          <li><strong>Delete your account</strong> at any time in the app from <strong>Settings →
            Delete account</strong>.</li>
          <li><strong>Control who sees your profile</strong> in <strong>Settings →
            Privacy</strong>.</li>
          <li><strong>Block or unblock players</strong> in <strong>Settings → Blocked
            players</strong>, and report content or players with the Report option in the
            app.</li>
          <li><strong>Location, camera and microphone</strong> are used only with your device
            permission, which you can turn off in your device settings. Hunts that check arrival at
            a place need location to work.</li>
          <li><strong>Get a copy of, or correct, your information</strong> by emailing us at <ContactEmail />.</li>
          <li><strong>Leave the research study</strong> at any time (section 5).</li>
        </ul>
        <p>Depending on where you live, you may have further legal rights over your information.
          Contact us and we will help; we will not treat you differently for using them.</p>
      </LegalSection>

      <LegalSection id="retention" title="8. How long we keep data">
        <p>We keep account information while your account is open. Uploaded photos and voice
          recordings are kept until you delete your account; if you record a spoken answer again
          before submitting it, the earlier take is deleted. When a moderator removes content, it
          is hidden from everyone rather than erased, so the decision can be reviewed.</p>
        <p>When you delete your account, in one step we:</p>
        <ul>
          <li><strong>Delete</strong> your own data: play history, answers, photos and voice
            recordings, chat messages, kudos, shoutouts and wall posts (sent and received), hunt
            reviews, friendships and blocks, team and class memberships, points, badges,
            assessment and survey answers, usage events, privacy settings, notifications and
            sign-in records.</li>
          <li><strong>Remove your identity</strong> from your account record: your email address,
            display name, avatar and date of birth are erased and your sign-in is deleted. What is
            left is an empty placeholder named &quot;Deleted user&quot;.</li>
          <li><strong>Keep, attributed only to &quot;Deleted user&quot;,</strong> things you made for
            other people: hunts and their stops, clues, challenges and media; class rosters and
            surveys you authored; moderation decisions you made; and reports you filed.</li>
          <li><strong>Keep reports about your content</strong>, including the copy of the reported
            content, as a safety record, and a de-identified record of any warnings, suspensions
            or bans you received (the type, reason and dates, without moderator notes).</li>
          <li><strong>Keep de-identified research records</strong> if you took part in the study:
            that you were enrolled, which version of the app you were assigned, and that you
            withdrew, so the study can count who left. Nothing more is collected about you.</li>
          <li><strong>Keep consent records</strong> reduced to the date, the version and whether
            consent was given, with the signer&apos;s name, IP address and verification details
            erased, and keep an internal record that the deletion happened.</li>
        </ul>
        <p>If you are a parent, the child and teen accounts you created are deleted in the same
          way. If you want a hunt you made taken down, delete it before you delete your account, or
          contact us. Research data that has already been de-identified for analysis cannot be
          linked back to you. If you have a question about a specific piece of data, contact
          us.</p>
      </LegalSection>

      <LegalSection id="security" title="9. Security">
        <p>Data is sent over encrypted connections. Access to each person&apos;s data in our
          database is restricted by access rules, uploaded photos and voice recordings are kept in
          private storage and shared only through links that expire, and
          passwords are handled by our authentication provider and are never visible to us. No
          system is perfectly secure, so please use a password you do not use elsewhere.</p>
      </LegalSection>

      <LegalSection id="changes" title="10. Changes to this policy">
        <p>If we change this policy, we will update the date at the top of this page. If a change
          materially affects how we use information we already hold, we will tell you in the app
          before it takes effect, and we will ask parents for new consent where COPPA requires
          it.</p>
      </LegalSection>

      <LegalSection id="contact" title="11. Contact us">
        <p>Questions, requests or concerns about privacy: <ContactEmail />.</p>
      </LegalSection>
    </LegalPage>
  );
}

import { formatCalendarDate } from "@shared/dates";
import { Entry, RopeHours, User, Supervisor, fieldMethodLabel } from '@shared/schema';
import { Resend } from 'resend';

// Configure Resend
let resend: Resend | null = null;
if (!process.env.RESEND_API_KEY) {
  console.warn('RESEND_API_KEY not found, emails will not be sent');
} else {
  resend = new Resend(process.env.RESEND_API_KEY);
  console.log('Resend API key configured');
}

// Sender address. Must be on a domain verified in Resend (EMAIL_FROM can be
// "Name <addr>" or a bare address).
const DEFAULT_FROM_EMAIL = 'noreply@n8ai.io';
const fromHeader = () => {
  const from = process.env.EMAIL_FROM?.trim();
  if (!from) return `Laborers Logbook <${DEFAULT_FROM_EMAIL}>`;
  return from.includes('<') ? from : `Laborers Logbook <${from}>`;
};

// Fallback production domain when APP_BASE_URL isn't set.
const CUSTOM_DOMAIN = 'ojt.n8ai.io';

// Base URL for links in emails/texts. APP_BASE_URL wins; otherwise production
// uses the custom domain and dev uses the host the request came in on, so a
// link requested from a phone over the tailnet opens on that phone too.
export const getBaseUrl = (req?: { protocol?: string; get(name: string): string | undefined }) => {
  const configured = process.env.APP_BASE_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    return `https://${CUSTOM_DOMAIN}`;
  }
  const host = req?.get('host');
  if (host) return `${req!.protocol || 'http'}://${host}`;
  return 'http://localhost:5000';
};

// Brand orange (--primary) for email buttons.
const BUTTON_STYLE = 'display: inline-block; padding: 12px 22px; background-color: #f16521; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600;';

// Send email with Resend
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  try {
    if (!resend) {
      console.error('RESEND_API_KEY not set');
      return false;
    }

    const { data, error } = await resend.emails.send({
      from: fromHeader(),
      to: [to],
      subject,
      html,
      text: html.replace(/<[^>]*>/g, '')
    });

    if (error) {
      console.error('Error sending email via Resend:', error);
      return false;
    }

    console.log('Email sent successfully via Resend:', data?.id);
    return true;
  } catch (error: any) {
    console.error('Error sending email via Resend:', error.message);
    return false;
  }
}

// Send verification request email for field-hours entries
export async function sendVerificationRequest(
  supervisor: Supervisor,
  user: User,
  entry: Entry,
  baseUrl: string = getBaseUrl()
): Promise<boolean> {
  const verificationUrl = `${baseUrl}/verify/${entry.verificationToken}`;

  console.log("\n-------------------------------------------------");
  console.log("VERIFICATION LINK (For testing):");
  console.log(verificationUrl);
  console.log("-------------------------------------------------\n");

  const displayMethod = fieldMethodLabel(entry.method);

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Field Hours Verification Request</h2>
      <p>${user.name || user.email} ${user.employeeNumber ? `(Employee #: ${user.employeeNumber})` : ''} has requested your verification for the following field hours:</p>
      
      <div style="background-color: #f4f4f4; padding: 15px; border-radius: 4px; margin: 20px 0;">
        <p><strong>Date:</strong> ${formatCalendarDate(entry.date)}</p>
        <p><strong>Location:</strong> ${entry.location}</p>
        <p><strong>Method:</strong> ${displayMethod}</p>
        <p><strong>Hours:</strong> ${entry.hours}</p>
      </div>
      
      <p>Please click the button below to verify these hours:</p>
      <p>
        <a 
          href="${verificationUrl}" 
          style="${BUTTON_STYLE}"
        >
          Verify Hours
        </a>
      </p>
      <p>Or copy and paste this URL into your browser:</p>
      <p>${verificationUrl}</p>
    </div>
  `;

  return await sendEmail(
    supervisor.email,
    `Verification Request for Field Hours from ${user.name || user.email}`,
    html
  );
}

// Send verification request email for Rope Hours entries
export async function sendRopeHoursVerificationRequest(
  supervisor: Supervisor,
  user: User,
  ropeHour: RopeHours,
  baseUrl: string = getBaseUrl()
): Promise<boolean> {
  const verificationUrl = `${baseUrl}/verify/${ropeHour.verificationToken}`;

  console.log("\n-------------------------------------------------");
  console.log("ROPE HOURS VERIFICATION LINK (For testing):");
  console.log(verificationUrl);
  console.log("-------------------------------------------------\n");

  const startDate = formatCalendarDate(ropeHour.startDate);
  const endDate = formatCalendarDate(ropeHour.endDate);

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Rope Access Hours Verification Request</h2>
      <p>${user.name || user.email} ${user.employeeNumber ? `(Employee #: ${user.employeeNumber})` : ''} has requested your verification for the following rope access hours:</p>
      
      <div style="background-color: #f4f4f4; padding: 15px; border-radius: 4px; margin: 20px 0;">
        <p><strong>Start Date:</strong> ${startDate}</p>
        <p><strong>End Date:</strong> ${endDate}</p>
        <p><strong>Location:</strong> ${ropeHour.location}</p>
        <p><strong>Skills Used:</strong> ${ropeHour.skills}</p>
        <p><strong>Hours:</strong> ${ropeHour.hours}</p>
      </div>
      
      <p>Please click the button below to verify these hours:</p>
      <p>
        <a 
          href="${verificationUrl}" 
          style="${BUTTON_STYLE}"
        >
          Verify Hours
        </a>
      </p>
      <p>Or copy and paste this URL into your browser:</p>
      <p>${verificationUrl}</p>
    </div>
  `;

  return await sendEmail(
    supervisor.email,
    `Verification Request for Rope Access Hours from ${user.name || user.email}`,
    html
  );
}

// Send a single batch verification request email covering multiple field-hours entries
export async function sendBatchVerificationRequest(
  supervisor: Supervisor,
  user: User,
  batchEntries: Entry[],
  batchToken: string,
  baseUrl: string = getBaseUrl()
): Promise<boolean> {
  const verificationUrl = `${baseUrl}/batch-verify/${batchToken}`;

  console.log("\n-------------------------------------------------");
  console.log("BATCH VERIFICATION LINK (For testing):");
  console.log(verificationUrl);
  console.log("-------------------------------------------------\n");

  const formatMethod = fieldMethodLabel;

  const rows = batchEntries.map(e => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;">${formatCalendarDate(e.date)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;">${e.location}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;">${formatMethod(e.method)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;">${e.hours.toFixed(1)}</td>
    </tr>`).join('');

  const totalHours = batchEntries.reduce((sum, e) => sum + e.hours, 0).toFixed(1);

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Field Hours Verification Request</h2>
      <p>${user.name || user.email} ${user.employeeNumber ? `(Employee #: ${user.employeeNumber})` : ''} has requested your verification for the following ${batchEntries.length} field-hours entries:</p>
      
      <table style="width:100%;border-collapse:collapse;margin:20px 0;background:#f4f4f4;border-radius:4px;">
        <thead>
          <tr style="background:#e0e0e0;">
            <th style="padding:8px 10px;text-align:left;">Date</th>
            <th style="padding:8px 10px;text-align:left;">Location</th>
            <th style="padding:8px 10px;text-align:left;">Method</th>
            <th style="padding:8px 10px;text-align:left;">Hours</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="3" style="padding:8px 10px;font-weight:bold;">Total</td>
            <td style="padding:8px 10px;font-weight:bold;">${totalHours}</td>
          </tr>
        </tfoot>
      </table>
      
      <p>Please click the button below to review and verify all of these entries at once:</p>
      <p>
        <a 
          href="${verificationUrl}" 
          style="${BUTTON_STYLE}"
        >
          Verify All Hours
        </a>
      </p>
      <p>Or copy and paste this URL into your browser:</p>
      <p>${verificationUrl}</p>
    </div>
  `;

  return await sendEmail(
    supervisor.email,
    `Batch Verification Request for Field Hours from ${user.name || user.email}`,
    html
  );
}

// Send verification confirmation email to user (field-hours entries)
// Invite a newly-created user: send their login email + a temporary password.
export async function sendInviteEmail(
  to: string,
  tempPassword: string,
  name?: string | null,
): Promise<boolean> {
  const loginUrl = `${getBaseUrl()}/auth`;
  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>You've been invited to Laborers Logbook</h2>
      <p>${name ? `Hi ${name},` : "Hi,"}</p>
      <p>An account has been created for you. Sign in with the credentials below:</p>

      <div style="background-color: #f4f4f4; padding: 15px; border-radius: 4px; margin: 20px 0;">
        <p><strong>Email:</strong> ${to}</p>
        <p><strong>Temporary password:</strong> ${tempPassword}</p>
      </div>

      <p>
        <a href="${loginUrl}" style="${BUTTON_STYLE}">
          Sign in
        </a>
      </p>
      <p style="color: #666; font-size: 13px;">
        For your security, please change this password after signing in. If you weren't expecting this invite, you can ignore this email.
      </p>
    </div>
  `;
  return await sendEmail(to, "Your Laborers Logbook account", html);
}

export async function sendVerificationConfirmation(
  user: User,
  entry: Entry,
  supervisorName: string
): Promise<boolean> {
  const displayMethod = fieldMethodLabel(entry.method);

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Field Hours Verified</h2>
      <p>Good news! Your field hours have been verified by ${supervisorName}:</p>
      
      <div style="background-color: #f4f4f4; padding: 15px; border-radius: 4px; margin: 20px 0;">
        <p><strong>Date:</strong> ${formatCalendarDate(entry.date)}</p>
        <p><strong>Location:</strong> ${entry.location}</p>
        <p><strong>Method:</strong> ${displayMethod}</p>
        <p><strong>Hours:</strong> ${entry.hours}</p>
        <p><strong>Verified By:</strong> ${supervisorName}</p>
      </div>
      
      <p>These hours have been added to your verified field hours log. You can view and export your log from your profile page.</p>
    </div>
  `;

  return await sendEmail(
    user.email,
    'Field Hours Verified',
    html
  );
}

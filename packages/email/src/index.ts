// Sending email (S1-6, N149): one port, `EmailSender`, and one adapter over SMTP. Every provider the owner may choose at S3 speaks SMTP,
// and Mailpit catches everything in development and staging. The first users are invitations, whose token lives in the message and
// nowhere else (spec RLS M01 §3.7): nothing here logs, and no error carries an address, a subject, a body or the SMTP URL (which holds
// the password of the account).
export * from './policy.js';
export * from './smtp-sender.js';

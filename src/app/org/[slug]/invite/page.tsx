export default function OrgInvitePage() {
  return (
    <>
      <section className="org-page-head">
        <div>
          <div className="org-eyebrow">Driver onboarding</div>
          <h1>Invite a driver</h1>
          <p>The invitation action is deliberately unavailable.</p>
        </div>
      </section>
      <section className="org-card org-gate-card">
        <div className="org-gate-icon" aria-hidden="true">
          !
        </div>
        <div>
          <h2>Security work must land before new invitations are issued</h2>
          <p>
            The current public consume path can replace an existing password and
            does not validate the national ID supplied by the Driver app.
            Existing identity-bound Driver redemption remains separate.
          </p>
          <dl className="org-gate-list">
            <div>
              <dt>Required</dt>
              <dd>Refuse credential overwrite</dd>
            </div>
            <div>
              <dt>Required</dt>
              <dd>Validate or remove national ID</dd>
            </div>
            <div>
              <dt>Required</dt>
              <dd>Complete the compatible identity-bound join path</dd>
            </div>
          </dl>
        </div>
        <button type="button" disabled>
          Send invitation
        </button>
      </section>
    </>
  );
}

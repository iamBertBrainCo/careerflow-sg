"""
Billing kill switch for the CareerFlow Google Cloud project.

A Cloud Billing budget publishes its status to a Pub/Sub topic several times a
day. When the reported cost reaches CAP_USD, this function unlinks the billing
account from the project, which stops every paid service in it (Cloud Run
included) so spending cannot keep growing. Re-link billing in the console to
bring the app back.

Based on Google's documented pattern:
https://cloud.google.com/billing/docs/how-to/disable-billing-with-notifications
"""

import base64
import json
import os

import functions_framework
from google.cloud import billing_v1

PROJECT_ID = os.environ["TARGET_PROJECT_ID"]
CAP_USD = float(os.getenv("CAP_USD", "1.0"))


@functions_framework.cloud_event
def stop_billing(cloud_event):
    message = json.loads(base64.b64decode(cloud_event.data["message"]["data"]).decode())
    cost = float(message.get("costAmount", 0))
    print(f"Budget update for {PROJECT_ID}: cost ${cost:.4f}, cap ${CAP_USD:.2f}")

    if cost < CAP_USD:
        return

    client = billing_v1.CloudBillingClient()
    name = f"projects/{PROJECT_ID}"
    info = client.get_project_billing_info(name=name)
    if not info.billing_enabled:
        print("Billing already disabled; nothing to do.")
        return

    client.update_project_billing_info(
        name=name,
        project_billing_info=billing_v1.ProjectBillingInfo(billing_account_name=""),
    )
    print(f"Cost ${cost:.4f} reached the ${CAP_USD:.2f} cap: billing disabled for {PROJECT_ID}.")

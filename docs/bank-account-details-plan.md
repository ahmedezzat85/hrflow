# Bank Account Details Feature

Add a separate **Bank Account Details** section to the employee profile.

- Do not include bank account fields in the **Add Employee** form.
- Place bank account management in a dedicated card within the Employee Details page, separate from the main employee information card.
- Display only a status indicator by default: **Bank details set** or **Bank details missing**.
- Provide an action button such as **Add Bank Details** or **Edit Bank Details**, depending on whether records already exist.
- Open a modal/pop-up form when the action button is clicked. The form will be used to add, view, or update the employee’s bank account information.
- Keep bank account values hidden in the normal employee-details view. Show sensitive values only inside the modal and consider masking account identifiers when displayed.
- Store bank information as a separate employee-related data entity/section so that it remains logically separate from the employee’s core profile data.

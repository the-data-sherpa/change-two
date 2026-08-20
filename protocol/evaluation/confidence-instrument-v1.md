# Confidence Instrument 1.0.0

Record one response after the final runner-owned Visible Check and before Hidden Checks or blinded review results are disclosed. The operator and active reviewer answer separately when both roles participated.

Do not change the questions or add outcome weight. Confidence is calibration evidence only.

1. What is the probability, from 0 to 1, that all acceptance criteria are satisfied?
2. What is the probability, from 0 to 1, that no prior behavior regressed?
3. What is the probability, from 0 to 1, that no severity-blocking authorization defect exists?
4. How many Hidden Checks do you expect to fail? Enter a non-negative integer.
5. State the highest-risk assumption in one testable sentence.

Encode the response with `schemas/protocol/v1/confidence-response.schema.json`. Record the response timestamp before evaluation starts. Do not revise a response after Hidden Check or review information becomes available. A correction must preserve the original record and state the correction reason.

(() => {
  const PRESETS = {
    USD: [25, 50, 100, 250],
    ZMW: [250, 500, 1000, 2500],
  };
  const DEFAULT_PRESET_INDEX = 1;
  const PREFIX = { USD: "$", ZMW: "K" };

  const root = document.querySelector("[data-donate]");
  if (!root) return;

  const amountStep = root.querySelector('[data-step="amount"]');
  const checkoutStep = root.querySelector('[data-step="checkout"]');
  const thanksStep = root.querySelector('[data-step="thanks"]');
  const declinedStep = root.querySelector('[data-step="declined"]');
  const amountGrid = root.querySelector("[data-amount-grid]");
  const customInput = root.querySelector("[data-custom-amount]");
  const currencyPrefix = root.querySelector("[data-currency-prefix]");
  const impactLine = root.querySelector("[data-impact]");
  const continueBtn = root.querySelector("[data-continue]");
  const backBtn = root.querySelector("[data-back]");
  const giveAgainBtns = [...root.querySelectorAll("[data-give-again]")];
  const amountError = root.querySelector("[data-error]");
  const checkoutError = root.querySelector("[data-checkout-error]");
  const statusEl = root.querySelector("[data-status]");
  const summaryEl = root.querySelector("[data-summary]");
  const resultLeadEl = root.querySelector("[data-result-lead]");
  const failDetailEl = root.querySelector("[data-fail-detail]");
  const failMailtoEl = root.querySelector("[data-fail-mailto]");
  const currencyButtons = [...root.querySelectorAll("[data-currency]")];

  let currency = "USD";
  let selectedAmount = PRESETS.USD[DEFAULT_PRESET_INDEX];
  let activeClient = null;
  let activeCheckout = null;
  let walletButtons = [];
  let checkoutGeneration = 0;
  let stepTransitionTimer = null;
  let stepResizeObserver = null;
  const stage = root.querySelector(".donate-stage") || root;
  const walletsEl = root.querySelector("[data-wallets]");
  const paymentHost = document.getElementById("ucPaymentContainer");
  const paymentScreen = document.getElementById("ucPaymentScreen");
  const steps = [amountStep, checkoutStep, thanksStep, declinedStep].filter(Boolean);
  const HEIGHT_BUFFER = 16;
  let ucLayoutObserver = null;

  const formatAmount = (value, code = currency) => {
    const number = Number(value);
    const formatted = number.toLocaleString("en-ZM", {
      minimumFractionDigits: Number.isInteger(number) ? 0 : 2,
      maximumFractionDigits: 2,
    });
    return `${PREFIX[code]}${formatted}`;
  };

  const showError = (el, message) => {
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = message;
  };

  const resetContinueButton = () => {
    if (!continueBtn) return;
    continueBtn.disabled = false;
    continueBtn.textContent = "Donate securely";
  };

  const measureActiveStepHeight = () => {
    const active = steps.find((step) => step.classList.contains("is-active"));
    if (!active || !stage) return;
    // Measure the live content, then add a small comfort buffer — no oversized min-heights.
    // Include stage padding so button glow room does not clip step content under border-box.
    const styles = window.getComputedStyle(stage);
    const padY =
      (Number.parseFloat(styles.paddingTop) || 0) +
      (Number.parseFloat(styles.paddingBottom) || 0);
    const nextHeight = Math.ceil(
      active.getBoundingClientRect().height + padY + HEIGHT_BUFFER,
    );
    stage.style.height = `${Math.max(nextHeight, 1)}px`;
  };

  const clearStatus = () => {
    if (!statusEl) return;
    statusEl.hidden = true;
    statusEl.textContent = "";
  };

  const syncUcLayout = () => {
    if (!paymentHost || !paymentScreen) return;
    const screenReady = paymentScreen.childElementCount > 0;
    const hostReady = paymentHost.childElementCount > 0;
    // Once the card form is open, collapse leftover selection chrome so it
    // does not leave a tall blank band above checkout.
    paymentHost.classList.toggle("is-collapsed", screenReady);
    const text = statusEl?.textContent || "";
    if (
      (screenReady || hostReady) &&
      (!text || /payment method|loading secure|choose a payment/i.test(text))
    ) {
      clearStatus();
    }
    measureActiveStepHeight();
  };

  const watchUcLayout = () => {
    if (typeof MutationObserver !== "function" || !paymentHost || !paymentScreen) return;
    if (ucLayoutObserver) ucLayoutObserver.disconnect();
    ucLayoutObserver = new MutationObserver(() => {
      syncUcLayout();
    });
    ucLayoutObserver.observe(paymentHost, { childList: true, subtree: true });
    ucLayoutObserver.observe(paymentScreen, { childList: true, subtree: true });
    syncUcLayout();
  };

  const watchActiveStepSize = () => {
    if (typeof ResizeObserver !== "function") return;
    if (stepResizeObserver) stepResizeObserver.disconnect();
    const active = steps.find((step) => step.classList.contains("is-active"));
    if (!active) return;
    stepResizeObserver = new ResizeObserver(() => {
      measureActiveStepHeight();
    });
    stepResizeObserver.observe(active);
    const embed = active.querySelector(".uc-embed");
    if (embed) stepResizeObserver.observe(embed);
  };

  const setStep = (name) => {
    const next = steps.find((step) => step.dataset.step === name);
    if (!next) return;

    if (stage && !stage.style.height) {
      const current = steps.find((step) => step.classList.contains("is-active")) || next;
      stage.style.height = `${Math.ceil(current.getBoundingClientRect().height + HEIGHT_BUFFER)}px`;
    }

    steps.forEach((step) => {
      const active = step === next;
      step.classList.toggle("is-active", active);
      step.classList.toggle("is-entering", active);
      step.classList.toggle("is-visible", active);
      step.setAttribute("aria-hidden", active ? "false" : "true");
    });

    root.classList.toggle("is-celebrating", name === "thanks");
    root.classList.toggle("is-soft-fail", name === "declined");

    if (stepTransitionTimer) window.clearTimeout(stepTransitionTimer);
    // Allow the incoming step to paint, then ease the card height to match.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        measureActiveStepHeight();
        watchActiveStepSize();
      });
    });
    stepTransitionTimer = window.setTimeout(() => {
      measureActiveStepHeight();
      watchActiveStepSize();
    }, 420);
  };

  const replayResultAnimations = (stepEl) => {
    if (!stepEl) return;
    // Force CSS animations to restart when this step becomes active again.
    const animated = stepEl.querySelectorAll(
      ".result-heading, .result-mark, .result-ring, .result-check, .result-cross, .result-burst span, .result-lead, .donate-thanks-actions, p",
    );
    animated.forEach((node) => {
      node.style.animation = "none";
    });
    // Reflow so the next animation frame picks up fresh keyframes.
    void stepEl.offsetWidth;
    animated.forEach((node) => {
      node.style.animation = "";
    });
  };

  const showApprovedResult = ({ amount, currency: code }) => {
    if (resultLeadEl) {
      resultLeadEl.textContent = `Thank you for your ${formatAmount(amount, code)} gift.`;
    }
    const thanksStep = steps.find((step) => step.dataset.step === "thanks");
    setStep("thanks");
    replayResultAnimations(thanksStep);
  };

  const friendlyFailureCopy = (raw) => {
    const text = String(raw || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) {
      return "We couldn't complete this gift. Try again, or write to us if you need help.";
    }
    if (
      /decision is reject|decision manager|non[- ]?3ds|risk rule|reason 481|\b481\b/i.test(
        text,
      )
    ) {
      return "Our payment security check couldn't approve this card. Try a different card, or check the details and try again.";
    }
    if (/insufficient|funds|balance/i.test(text)) {
      return "Your bank said there weren't enough funds for this gift. Try another card, or try again later.";
    }
    if (/expired/i.test(text)) {
      return "This card looks expired. Check the expiry date, or try a different card.";
    }
    if (/cvv|cvc|security code|card verification/i.test(text)) {
      return "The security code didn't match. Check the digits on the back of your card and try again.";
    }
    if (/invalid account|invalid card|lost card|stolen|pick up/i.test(text)) {
      return "Your bank couldn't use this card. Try a different card, or contact your bank for help.";
    }
    if (/do not honor|not authorized|denied|issuer|declin/i.test(text)) {
      return "Your bank declined this payment. Try another card, or ask your bank to allow the charge.";
    }
    if (/discount|0\.00|not collected|cancelled|canceled/i.test(text)) {
      return "The payment didn't go through for the amount you chose. Please try again.";
    }
    if (
      /failed|undefined|null|TypeError|NetworkError|JWT|Cybersource|fetch|VAS|UnifiedCheckout|autoProcessing/i.test(
        text,
      )
    ) {
      return "We couldn't finish the payment just now. Wait a moment and try again, or write to us if it keeps happening.";
    }
    if (text.length <= 140 && !/ics_|rFlag|reason code/i.test(text)) {
      return `${text.replace(/\.$/, "")}. Try again, or write to us if you need help.`;
    }
    return "We couldn't complete this gift. Try another card, or write to us if you need help.";
  };

  const showDeclinedResult = (rawMessage) => {
    const detail = friendlyFailureCopy(rawMessage);
    if (failDetailEl) failDetailEl.textContent = detail;
    if (failMailtoEl) {
      failMailtoEl.href =
        "mailto:e.munalula@mulatiwafoundation.org?subject=" +
        encodeURIComponent("Donation help") +
        "&body=" +
        encodeURIComponent(
          "Hi.\n\nI tried to make a donation and it was unsuccessful.\n\nDetails shown on the site:\n" +
            detail +
            "\n\n",
        );
    }
    const declinedStep = steps.find((step) => step.dataset.step === "declined");
    setStep("declined");
    replayResultAnimations(declinedStep);
  };

  const notifyComplete = async ({
    status,
    amount,
    currency,
    reference,
    resultJwt,
    transientToken,
    paymentResult,
    paymentCompleted,
    errorMessage,
  }) => {
    const response = await fetch("/api/donate/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        amount,
        currency,
        reference,
        result_jwt: resultJwt || "",
        // Mount transient token keeps bill-to/email available via Payment Details
        // even after complete() returns a payment object without those fields.
        transient_token: transientToken || "",
        payment_result: paymentResult || null,
        payment_completed: Boolean(paymentCompleted),
        error_message: errorMessage || "",
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || "Could not confirm donation with the server.");
    }
    return body;
  };

  const updateImpact = () => {
    if (!impactLine) return;
    impactLine.textContent = "Every gift keeps this work moving.";
  };

  const renderPresets = () => {
    if (!amountGrid) return;
    amountGrid.innerHTML = "";
    PRESETS[currency].forEach((value, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "amount-option";
      button.dataset.amount = String(value);
      button.setAttribute("aria-pressed", "false");
      button.textContent = formatAmount(value);
      if (index === DEFAULT_PRESET_INDEX) {
        selectedAmount = value;
        button.classList.add("is-selected");
        button.setAttribute("aria-pressed", "true");
      }
      button.addEventListener("click", () => {
        selectedAmount = value;
        if (customInput) customInput.value = "";
        amountGrid.querySelectorAll(".amount-option").forEach((item) => {
          const active = item === button;
          item.classList.toggle("is-selected", active);
          item.setAttribute("aria-pressed", String(active));
        });
        showError(amountError, "");
      });
      amountGrid.appendChild(button);
    });
    if (currencyPrefix) currencyPrefix.textContent = PREFIX[currency];
    if (customInput) {
      customInput.min = currency === "ZMW" ? "10" : "1";
      customInput.placeholder = currency === "ZMW" ? "0" : "0.00";
    }
    updateImpact();
  };

  const getAmount = () => {
    const custom = customInput?.value?.trim();
    if (custom) {
      const parsed = Number(custom);
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      return Math.round(parsed * 100) / 100;
    }
    return selectedAmount;
  };

  const loadScript = (src, integrity) =>
    new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-uc-library="true"]`);
      if (existing) existing.remove();

      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.dataset.ucLibrary = "true";
      if (integrity) {
        script.integrity = integrity;
        script.crossOrigin = "anonymous";
      }
      script.onload = () => resolve();
      script.onerror = () =>
        reject(
          new Error(
            "We're having some trouble proceeding right now. Please try again later.",
          ),
        );
      document.head.appendChild(script);
    });

  const clearCheckoutContainers = () => {
    const apple = document.getElementById("ucApplePay");
    const google = document.getElementById("ucGooglePay");
    if (paymentHost) {
      paymentHost.innerHTML = "";
      paymentHost.classList.remove("is-collapsed");
    }
    if (paymentScreen) paymentScreen.innerHTML = "";
    if (apple) apple.innerHTML = "";
    if (google) google.innerHTML = "";
    if (walletsEl) walletsEl.hidden = true;
  };

  const destroyCheckout = () => {
    walletButtons.forEach((button) => {
      try {
        button?.destroy?.();
      } catch {
        // Ignore destroy failures when resetting
      }
    });
    walletButtons = [];
    try {
      activeCheckout?.destroy?.();
    } catch {
      // Ignore destroy failures when resetting
    }
    try {
      activeClient?.destroy?.();
    } catch {
      // Ignore destroy failures when resetting
    }
    activeCheckout = null;
    activeClient = null;
  };

  const startWalletButtons = (client) => {
    if (!client || typeof client.createButton !== "function") return [];
    const slots = [
      ["APPLEPAY", "ucApplePay"],
      ["GOOGLEPAY", "ucGooglePay"],
    ];
    const pending = [];
    let mounted = 0;
    slots.forEach(([type, id]) => {
      const slot = document.getElementById(id);
      if (!slot) return;
      try {
        const button = client.createButton(type, { autoProcessing: false });
        walletButtons.push(button);
        // Resolve only on a completed wallet payment. Mount failures must not
        // reject the card Trigger path racing alongside these promises.
        pending.push(
          new Promise((resolve) => {
            Promise.resolve(button.mount(`#${id}`))
              .then(resolve)
              .catch(() => {
                slot.innerHTML = "";
              });
          }),
        );
        mounted += 1;
      } catch {
        slot.innerHTML = "";
      }
    });
    if (walletsEl) {
      walletsEl.hidden = mounted === 0;
      measureActiveStepHeight();
    }
    return pending;
  };

  const resetToAmount = () => {
    checkoutGeneration += 1;
    destroyCheckout();
    clearCheckoutContainers();
    showError(checkoutError, "");
    showError(amountError, "");
    resetContinueButton();
    clearStatus();
    setStep("amount");
  };

  const decodeJwtPayload = (jwt) => {
    try {
      const parts = String(jwt).split(".");
      if (parts.length < 2) return null;
      const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
      return JSON.parse(atob(padded));
    } catch {
      return null;
    }
  };

  const isTransientToken = (result) => {
    if (typeof result !== "string") return false;
    const payload = decodeJwtPayload(result);
    if (!payload) return false;
    const type = String(payload.type || "");
    const iss = String(payload.iss || "");
    if (type.startsWith("gda")) return true;
    if (/Flex/i.test(iss)) return true;
    if (payload.content?.processingInformation || payload.content?.status || payload.status) {
      return false;
    }
    return Boolean(payload.jti);
  };

  const extractReference = (result) => {
    if (!result) return null;
    if (typeof result === "string") {
      const payload = decodeJwtPayload(result);
      return (
        payload?.transactionId ||
        payload?.id ||
        payload?.content?.transactionId ||
        payload?.content?.id ||
        payload?.jti ||
        result.slice(0, 24) + "…"
      );
    }
    if (typeof result === "object") {
      return (
        result.id ||
        result.transactionId ||
        result.reconciliationId ||
        result.processorInformation?.transactionId ||
        result.submitTimeUtc ||
        null
      );
    }
    return null;
  };

  const finalizeCheckoutResult = async (mountResult) => {
    // mount() returns a transient token when autoProcessing is false. Calling
    // complete() is what runs Payer Authentication (3DS) under completeMandate
    // and finishes the sale. Tell the server that so it does not capture again.
    if (!isTransientToken(mountResult)) {
      return { result: mountResult, paymentCompleted: true };
    }

    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = "Verifying your card with 3-D Secure…";
    }
    measureActiveStepHeight();

    if (!activeCheckout || typeof activeCheckout.complete !== "function") {
      // Fall back to server PTS if complete() is unavailable.
      if (statusEl) statusEl.textContent = "Confirming your gift with the bank…";
      return { result: mountResult, paymentCompleted: false };
    }

    try {
      const completed = await activeCheckout.complete(mountResult);
      return { result: completed, paymentCompleted: true };
    } catch (error) {
      // If complete() is refused because autoProcessing already handled it,
      // keep the mount result for the server path.
      const message = String(error?.message || "");
      if (/autoProcessing|already|complete mandate/i.test(message)) {
        return { result: mountResult, paymentCompleted: false };
      }
      throw error;
    }
  };

  const startCheckout = async () => {
    const amount = getAmount();
    if (amount == null) {
      showError(amountError, "Enter a valid donation amount.");
      return;
    }

    showError(amountError, "");
    const generation = ++checkoutGeneration;
    continueBtn.disabled = true;
    continueBtn.textContent = "Opening secure payment…";

    try {
      const response = await fetch("/api/donate/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, currency }),
      });
      const payload = await response.json().catch(() => ({}));
      if (generation !== checkoutGeneration) return;
      if (!response.ok) {
        throw new Error(
          payload.error ||
            "We're having some trouble proceeding right now. Please try again later.",
        );
      }

      await loadScript(payload.client_library, payload.client_library_integrity);
      if (generation !== checkoutGeneration) return;

      if (typeof window.VAS?.UnifiedCheckout !== "function") {
        throw new Error(
          "We're having some trouble proceeding right now. Please try again later.",
        );
      }

      if (summaryEl) {
        summaryEl.textContent = `${formatAmount(payload.amount, payload.currency)} gift`;
      }

      destroyCheckout();
      setStep("checkout");
      clearCheckoutContainers();
      showError(checkoutError, "");
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = "Loading secure card payment…";
      }
      watchUcLayout();
      measureActiveStepHeight();

      // Embedded in-card checkout (selection + payment screen) with live height resizing.
      activeClient = await window.VAS.UnifiedCheckout(payload.capture_context);
      if (generation !== checkoutGeneration) return;

      const walletPending = startWalletButtons(activeClient);
      // Collect card details first, then complete() so Unified Checkout can run 3DS
      // under completeMandate.consumerAuthentication before the sale is finished.
      activeCheckout = await activeClient.createCheckout({
        autoProcessing: false,
      });
      if (generation !== checkoutGeneration) return;

      const cardPending = activeCheckout.mount({
        paymentSelection: "#ucPaymentContainer",
        paymentScreen: "#ucPaymentScreen",
      });
      // After the form paints, collapse empty selection chrome and fit the card height.
      window.setTimeout(syncUcLayout, 120);
      window.setTimeout(syncUcLayout, 400);
      window.setTimeout(syncUcLayout, 900);

      const mountResponse = await Promise.race([cardPending, ...walletPending]);
      if (generation !== checkoutGeneration) return;
      measureActiveStepHeight();
      const transientToken = isTransientToken(mountResponse) ? mountResponse : "";
      const finalized = await finalizeCheckoutResult(mountResponse);
      if (generation !== checkoutGeneration) return;
      const completeResponse = finalized?.result;
      const paymentCompleted = Boolean(finalized?.paymentCompleted);
      const reference = extractReference(completeResponse);
      const resultJwt = typeof completeResponse === "string" ? completeResponse : "";
      const paymentResult =
        completeResponse && typeof completeResponse === "object" ? completeResponse : null;

      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = "Recording your gift…";
      }

      // Server verifies against Cybersource. After UC complete(), skip a second
      // PTS capture and confirm the final decision from the payment result / TSS.
      // Keep the mount transient token so Payment Details can return donor email.
      const recorded = await notifyComplete({
        status: "approved",
        amount: payload.amount,
        currency: payload.currency,
        reference,
        resultJwt,
        transientToken,
        paymentResult,
        paymentCompleted,
      });
      if (generation !== checkoutGeneration) return;

      destroyCheckout();
      clearCheckoutContainers();

      if (recorded?.status && recorded.status !== "approved") {
        showDeclinedResult(recorded.error_message || recorded.status);
        return;
      }

      showApprovedResult({
        amount: recorded?.amount || payload.amount,
        currency: recorded?.currency || payload.currency,
      });
    } catch (error) {
      if (generation !== checkoutGeneration) return;
      console.error("[donate]", error);
      const rawMessage = error?.message && typeof error.message === "string" ? error.message : "";
      const reason = error?.reason || "";
      const aborted =
        /cancel|abort|close|dismiss/i.test(rawMessage) ||
        /CANCEL|ABORT|CLOSE|DISMISS/i.test(String(reason)) ||
        error?.name === "AbortError";
      const declined =
        /DECLIN|REJECT|FAIL|DENIED|NOT_AUTHORIZED|PAYMENT/i.test(String(reason)) ||
        /declin|rejected|not authorized|payment failed|decision is reject/i.test(rawMessage);

      destroyCheckout();
      clearCheckoutContainers();

      if (aborted) {
        showError(amountError, "Checkout was closed. You can try again when ready.");
        setStep("amount");
        return;
      }

      const failureDetail = rawMessage || String(reason || "");

      if (declined) {
        try {
          await notifyComplete({
            status: "declined",
            amount,
            currency,
            reference: "",
            resultJwt: "",
            errorMessage: failureDetail,
          });
        } catch (notifyError) {
          console.error("[donate] declined notify failed", notifyError);
        }
        showDeclinedResult(failureDetail);
        return;
      }

      const friendly =
        rawMessage &&
        !/failed|undefined|null|TypeError|NetworkError|JWT|Cybersource|fetch|VAS|UnifiedCheckout|autoProcessing/i.test(
          rawMessage,
        )
          ? rawMessage
          : "We're having some trouble proceeding right now. Please try again later.";

      try {
        await notifyComplete({
          status: "failed",
          amount,
          currency,
          reference: "",
          resultJwt: "",
          errorMessage: failureDetail || friendly,
        });
      } catch (notifyError) {
        console.error("[donate] failed notify failed", notifyError);
      }

      showDeclinedResult(failureDetail || friendly);
    } finally {
      if (generation === checkoutGeneration) {
        resetContinueButton();
      }
    }
  };

  currencyButtons.forEach((button) => {
    button.addEventListener("click", () => {
      currency = button.dataset.currency;
      currencyButtons.forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      if (customInput) customInput.value = "";
      showError(amountError, "");
      renderPresets();
    });
  });

  customInput?.addEventListener("input", () => {
    if (!customInput.value.trim()) return;
    amountGrid?.querySelectorAll(".amount-option").forEach((item) => {
      item.classList.remove("is-selected");
      item.setAttribute("aria-pressed", "false");
    });
    showError(amountError, "");
  });

  continueBtn?.addEventListener("click", () => {
    void startCheckout();
  });

  backBtn?.addEventListener("click", () => {
    resetToAmount();
  });

  giveAgainBtns.forEach((button) => {
    button.addEventListener("click", () => {
      resetToAmount();
    });
  });

  renderPresets();
  setStep("amount");
  window.addEventListener("resize", measureActiveStepHeight);

  // Local/UI previews: /donate.html?preview=success|declined
  const preview = new URLSearchParams(window.location.search).get("preview");
  if (preview === "success") {
    showApprovedResult({ amount: selectedAmount, currency });
  } else if (preview === "declined") {
    setStep("declined");
  }
})();

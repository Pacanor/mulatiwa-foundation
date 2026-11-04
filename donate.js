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
  const currencyButtons = [...root.querySelectorAll("[data-currency]")];

  let currency = "USD";
  let selectedAmount = PRESETS.USD[DEFAULT_PRESET_INDEX];
  let activeClient = null;
  let activeCheckout = null;

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

  const setStep = (name) => {
    [amountStep, checkoutStep, thanksStep, declinedStep].forEach((step) => {
      if (!step) return;
      const active = step.dataset.step === name;
      step.hidden = !active;
      step.classList.toggle("is-entering", active);
      if (active) {
        // Retrigger CSS entrance animations
        void step.offsetWidth;
        step.classList.add("is-visible");
      } else {
        step.classList.remove("is-visible");
      }
    });
    root.classList.toggle("is-celebrating", name === "thanks");
    root.classList.toggle("is-soft-fail", name === "declined");
  };

  const showApprovedResult = ({ amount, currency: code }) => {
    if (resultLeadEl) {
      resultLeadEl.textContent = `Thank you for your ${formatAmount(amount, code)} gift.`;
    }
    setStep("thanks");
  };

  const notifyComplete = async ({
    status,
    amount,
    currency,
    reference,
    resultJwt,
    errorMessage,
  }) => {
    try {
      await fetch("/api/donate/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          amount,
          currency,
          reference,
          result_jwt: resultJwt || "",
          error_message: errorMessage || "",
        }),
      });
    } catch (error) {
      console.error("[donate] notify failed", error);
    }
  };

  const updateImpact = () => {
    if (!impactLine) return;
    impactLine.textContent = "Gifts like this from you will keep us moving.";
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
    const host = document.getElementById("ucPaymentContainer");
    if (host) host.innerHTML = "";
  };

  const destroyCheckout = () => {
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

  const resetToAmount = () => {
    destroyCheckout();
    clearCheckoutContainers();
    showError(checkoutError, "");
    if (statusEl) {
      statusEl.hidden = true;
      statusEl.textContent = "";
    }
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

  const extractReference = (result) => {
    if (!result) return null;
    if (typeof result === "string") {
      const payload = decodeJwtPayload(result);
      return (
        payload?.transactionId ||
        payload?.id ||
        payload?.content?.transactionId ||
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

  const startCheckout = async () => {
    const amount = getAmount();
    if (amount == null) {
      showError(amountError, "Enter a valid donation amount.");
      return;
    }

    showError(amountError, "");
    continueBtn.disabled = true;
    continueBtn.textContent = "Opening secure payment…";

    try {
      const response = await fetch("/api/donate/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, currency }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          payload.error ||
            "We're having some trouble proceeding right now. Please try again later.",
        );
      }

      await loadScript(payload.client_library, payload.client_library_integrity);

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
        statusEl.textContent = "Opening secure card payment…";
      }

      // Trigger opens card entry directly — skips the "Checkout with card" button list.
      activeClient = await window.VAS.UnifiedCheckout(payload.capture_context);
      activeCheckout = activeClient.createTrigger("PANENTRY", {
        displayMode: "sidebar",
        autoProcessing: true,
      });

      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = "Complete your gift in the secure payment window.";
      }

      const completeResponse = await activeCheckout.mount("#ucPaymentContainer");
      const reference = extractReference(completeResponse);

      destroyCheckout();
      clearCheckoutContainers();
      showApprovedResult({
        amount: payload.amount,
        currency: payload.currency,
      });

      void notifyComplete({
        status: "approved",
        amount: payload.amount,
        currency: payload.currency,
        reference,
        resultJwt: typeof completeResponse === "string" ? completeResponse : "",
      });
    } catch (error) {
      console.error("[donate]", error);
      const rawMessage = error?.message && typeof error.message === "string" ? error.message : "";
      const reason = error?.reason || "";
      const aborted =
        /cancel|abort|close|dismiss/i.test(rawMessage) ||
        /CANCEL|ABORT|CLOSE|DISMISS/i.test(String(reason)) ||
        error?.name === "AbortError";
      const declined =
        /DECLIN|REJECT|FAIL|DENIED|NOT_AUTHORIZED|PAYMENT/i.test(String(reason)) ||
        /declin|rejected|not authorized|payment failed/i.test(rawMessage);

      destroyCheckout();
      clearCheckoutContainers();

      if (aborted) {
        showError(amountError, "Checkout was closed. You can try again when ready.");
        setStep("amount");
        return;
      }

      if (declined) {
        setStep("declined");
        void notifyComplete({
          status: "declined",
          amount,
          currency,
          reference: "",
          resultJwt: "",
          errorMessage: rawMessage || String(reason || ""),
        });
        return;
      }

      const friendly =
        rawMessage &&
        !/failed|undefined|null|TypeError|NetworkError|JWT|Cybersource|fetch|VAS|UnifiedCheckout/i.test(
          rawMessage,
        )
          ? rawMessage
          : "We're having some trouble proceeding right now. Please try again later.";

      void notifyComplete({
        status: "failed",
        amount,
        currency,
        reference: "",
        resultJwt: "",
        errorMessage: rawMessage || String(reason || friendly),
      });

      if (checkoutStep && !checkoutStep.hidden) {
        showError(checkoutError, friendly);
        if (statusEl) statusEl.hidden = true;
      } else {
        showError(amountError, friendly);
        setStep("amount");
      }
    } finally {
      continueBtn.disabled = false;
      continueBtn.textContent = "Donate securely";
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

  // Local/UI previews: /donate.html?preview=success|declined
  const preview = new URLSearchParams(window.location.search).get("preview");
  if (preview === "success") {
    showApprovedResult({ amount: selectedAmount, currency });
  } else if (preview === "declined") {
    setStep("declined");
  }
})();

import { useEffect, useState } from "react";
import AddAPhotoOutlined from "@material-ui/icons/AddAPhotoOutlined";
import ArrowForward from "@material-ui/icons/ArrowForward";
import CheckCircleOutline from "@material-ui/icons/CheckCircleOutline";
import LocationOnOutlined from "@material-ui/icons/LocationOnOutlined";
import Replay from "@material-ui/icons/Replay";
import SendOutlined from "@material-ui/icons/SendOutlined";
import WarningOutlined from "@material-ui/icons/WarningOutlined";

const API_BASE = (process.env.REACT_APP_API_URL || "")
  .trim()
  .replace(/\/+$/, "")
  .replace(/\/predict$/i, "");
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const FALLBACK_LOCATIONS = {
  Bulawayo: ["Bulawayo"],
  Harare: ["Chitungwiza", "Epworth", "Harare"],
  Manicaland: ["Buhera", "Chimanimani", "Chipinge", "Makoni", "Mutare", "Mutasa", "Nyanga"],
  "Mashonaland Central": ["Bindura", "Guruve", "Mazowe", "Mbire", "Mount Darwin", "Muzarabani", "Rushinga", "Shamva"],
  "Mashonaland East": ["Chikomba", "Goromonzi", "Hwedza", "Marondera", "Murehwa", "Mutoko", "Seke", "Uzumba-Maramba-Pfungwe"],
  "Mashonaland West": ["Chegutu", "Hurungwe", "Kariba", "Makonde", "Mhondoro-Ngezi", "Sanyati", "Zvimba"],
  Masvingo: ["Bikita", "Chiredzi", "Chivi", "Gutu", "Masvingo", "Mwenezi", "Zaka"],
  "Matabeleland North": ["Binga", "Bubi", "Hwange", "Lupane", "Nkayi", "Tsholotsho", "Umguza"],
  "Matabeleland South": ["Beitbridge", "Bulilima", "Gwanda", "Insiza", "Mangwe", "Matobo", "Umzingwane"],
  Midlands: ["Chirumhanzu", "Gokwe North", "Gokwe South", "Gweru", "Kwekwe", "Mberengwa", "Shurugwi", "Silobela", "Zvishavane"],
};

function getFarmerId() {
  try {
    const savedId = window.localStorage.getItem("agriagent-farmer-id");
    if (savedId) return savedId;
    const farmerId = window.crypto?.randomUUID?.()
      || `farmer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem("agriagent-farmer-id", farmerId);
    return farmerId;
  } catch {
    return `farmer-${Date.now()}`;
  }
}

function App() {
  const [locations, setLocations] = useState(FALLBACK_LOCATIONS);
  const [province, setProvince] = useState("");
  const [district, setDistrict] = useState("");
  const [growthPoint, setGrowthPoint] = useState("");
  const [village, setVillage] = useState("");
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(window.navigator.onLine);
  const [feedback, setFeedback] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [followUpMode, setFollowUpMode] = useState("question");
  const [followUpMessage, setFollowUpMessage] = useState("");
  const [followUpFile, setFollowUpFile] = useState(null);
  const [followUpReply, setFollowUpReply] = useState(null);
  const [followUpBusy, setFollowUpBusy] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/locations`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data && Object.keys(data).length) setLocations(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return undefined;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => {
    const updateOnline = () => setOnline(window.navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  const selectPhoto = (event) => {
    const nextFile = event.target.files?.[0];
    event.target.value = "";
    if (!nextFile) return;
    if (!nextFile.type.startsWith("image/")) {
      setError("Choose an image file to continue.");
      return;
    }
    if (nextFile.size > MAX_IMAGE_BYTES) {
      setError("Choose an image smaller than 8 MB.");
      return;
    }
    setError("");
    setResult(null);
    setFeedback("");
    setFile(nextFile);
  };

  const submitDiagnosis = async (event) => {
    event.preventDefault();
    if (!file) {
      setError("Add a tomato leaf photo first.");
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("farmer_id", getFarmerId());
    formData.append("province", province);
    formData.append("district", district);
    formData.append("growth_point", growthPoint.trim());
    formData.append("village", village.trim());

    try {
      const response = await fetch(`${API_BASE}/api/diagnose`, {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || "The diagnosis could not be completed.");
      }
      setResult(payload);
    } catch (requestError) {
      setError(requestError.message || "Connection interrupted. Your photo is ready to retry.");
    } finally {
      setBusy(false);
    }
  };

  const sendFeedback = async (didTreatmentWork) => {
    if (!result?.diagnosis_id) return;
    setFeedbackBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          diagnosis_id: result.diagnosis_id,
          farmer_id: getFarmerId(),
          did_treatment_work: didTreatmentWork,
        }),
      });
      if (!response.ok) throw new Error("Feedback could not be saved.");
      setFeedback("Thank you. Your feedback has been recorded.");
    } catch (requestError) {
      setFeedback(requestError.message);
    } finally {
      setFeedbackBusy(false);
    }
  };

  const sendFollowUp = async () => {
    if (!result?.diagnosis_id || followUpBusy) return;
    if (followUpMode === "question" && !followUpMessage.trim()) {
      setFollowUpReply({ response_text: "Enter a question about this diagnosis." });
      return;
    }
    if (followUpMode === "new_photo" && !followUpFile) {
      setFollowUpReply({ response_text: "Choose a new leaf photo first." });
      return;
    }

    setFollowUpBusy(true);
    setFollowUpReply(null);
    const formData = new FormData();
    formData.append("farmer_id", getFarmerId());
    formData.append("diagnosis_id", result.diagnosis_id);
    formData.append("message", followUpMode === "question" ? followUpMessage.trim() : "");
    formData.append("update_location", String(followUpMode === "location"));
    if (followUpMode === "location") {
      formData.append("province", province);
      formData.append("district", district);
      formData.append("growth_point", growthPoint.trim());
      formData.append("village", village.trim());
    }
    if (followUpMode === "new_photo") formData.append("file", followUpFile);

    try {
      const response = await fetch(`${API_BASE}/api/follow-up`, {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "Follow-up could not be completed.");
      setFollowUpReply(payload);
      if (payload.follow_up_intent === "new_photo") {
        setResult((current) => ({ ...current, ...payload }));
        setFollowUpFile(null);
      }
    } catch (requestError) {
      setFollowUpReply({ response_text: requestError.message || "Connection interrupted. Please retry." });
    } finally {
      setFollowUpBusy(false);
    }
  };

  const resetDiagnosis = () => {
    setResult(null);
    setError("");
    setFeedback("");
    setFile(null);
  };

  const treatment = result?.treatment;
  const lowConfidence = result?.triage_status === "low_confidence";
  const unrecognized = result?.triage_status === "unrecognized";
  const healthy = result?.predicted_class === "Tomato_healthy";

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand-lockup" href="/" aria-label="AgriAgent home">
          <span className="brand-mark">OGK</span>
          <span className="brand-copy">
            <strong>AgriAgent</strong>
            <span>OGK field tools</span>
          </span>
        </a>
        <div className={`connection-state ${online ? "is-online" : "is-offline"}`}>
          <span className="connection-dot" />
          {online ? "Connected" : "Offline"}
        </div>
      </header>

      <main className="page-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow">TOMATO CROP · ZIMBABWE</p>
            <h1>Leaf diagnosis</h1>
            <p className="heading-note">Your crop, checked with care.</p>
          </div>
          <div className="season-stamp" aria-label="English language">
            <span className="season-stamp-line" />
            <span>EN</span>
          </div>
        </div>

        <form className="diagnosis-form" onSubmit={submitDiagnosis}>
          <div className="work-columns">
            <section className="photo-column" aria-labelledby="photo-heading">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">01 / IMAGE</p>
                  <h2 id="photo-heading">Leaf photo</h2>
                </div>
                {file && <span className="file-size">{(file.size / 1024 / 1024).toFixed(1)} MB</span>}
              </div>

              <div className={`photo-stage ${previewUrl ? "has-photo" : ""}`}>
                {previewUrl ? (
                  <>
                    <img className="photo-preview" src={previewUrl} alt="Selected tomato leaf" />
                    <button className="photo-change" type="button" onClick={() => document.getElementById("leaf-photo").click()}>
                      <Replay fontSize="small" /> Replace photo
                    </button>
                  </>
                ) : (
                  <label className="photo-picker" htmlFor="leaf-photo">
                    <span className="photo-icon"><AddAPhotoOutlined /></span>
                    <strong>Add leaf photo</strong>
                    <span>JPG, PNG or WebP · up to 8 MB</span>
                    <span className="picker-action">Open camera or gallery <ArrowForward fontSize="small" /></span>
                  </label>
                )}
                <input
                  id="leaf-photo"
                  className="visually-hidden"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={selectPhoto}
                />
              </div>
              <div className="photo-caption">
                <span className="caption-rule" />
                <span>Tomato leaf</span>
                <span className="caption-divider">/</span>
                <span>Natural light</span>
              </div>
            </section>

            <section className="location-column" aria-labelledby="location-heading">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">02 / LOCATION</p>
                  <h2 id="location-heading">Your area</h2>
                </div>
                <LocationOnOutlined className="section-icon" />
              </div>

              <label className="field-label" htmlFor="province">Province</label>
              <select
                id="province"
                required
                value={province}
                onChange={(event) => {
                  setProvince(event.target.value);
                  setDistrict("");
                }}
              >
                <option value="">Choose province</option>
                {Object.keys(locations).sort().map((name) => <option key={name} value={name}>{name}</option>)}
              </select>

              <label className="field-label" htmlFor="district">District</label>
              <select
                id="district"
                required
                disabled={!province}
                value={district}
                onChange={(event) => setDistrict(event.target.value)}
              >
                <option value="">Choose district</option>
                {(locations[province] || []).map((name) => <option key={name} value={name}>{name}</option>)}
              </select>

              <label className="field-label" htmlFor="growth-point">Growth point / nearby town</label>
              <input
                id="growth-point"
                required
                maxLength="120"
                value={growthPoint}
                onChange={(event) => setGrowthPoint(event.target.value)}
                placeholder="e.g. Mbare"
                autoComplete="address-level2"
              />

              <label className="field-label" htmlFor="village">Village / place <span>Optional</span></label>
              <input
                id="village"
                maxLength="120"
                value={village}
                onChange={(event) => setVillage(event.target.value)}
                placeholder="Your village or place"
                autoComplete="address-line1"
              />

              <p className="location-footnote">Location is used to find nearby agricultural support.</p>
            </section>
          </div>

          {error && (
            <div className="message-banner error-banner" role="alert">
              <WarningOutlined />
              <span>{error}</span>
            </div>
          )}

          <div className="form-actions">
            <span className="privacy-note">Your photo is used for this diagnosis.</span>
            <button className="primary-button" type="submit" disabled={busy || !file}>
              {busy ? <span className="button-spinner" /> : <SendOutlined fontSize="small" />}
              {busy ? "Checking leaf" : "Get diagnosis"}
            </button>
          </div>
        </form>

        {busy && <div className="progress-line" role="status">Checking the photo and preparing local guidance…</div>}

        {result && (
          <section className="result-section" aria-live="polite" aria-labelledby="result-heading">
            <div className="result-topline">
              <div>
                <p className="eyebrow">FIELD RESULT</p>
                <h2 id="result-heading">{unrecognized ? "Photo not recognized" : healthy ? "Plant looks healthy" : treatment?.common_name || "Possible diagnosis"}</h2>
              </div>
              <span className={`confidence-tag ${lowConfidence || unrecognized ? "confidence-caution" : ""}`}>
                {result.confidence != null ? `${Math.round(result.confidence * 100)}% match` : "Retake photo"}
              </span>
            </div>

            <p className="result-explainer">{result.response_text}</p>

            {result.persistence_status === "not_configured" && (
              <p className="storage-note">Diagnosis storage is not connected yet. This result is not saved.</p>
            )}
            {result.persistence_status === "failed" && (
              <p className="storage-note">Diagnosis complete, but saving failed. Keep this result open.</p>
            )}

            {unrecognized ? (
              <div className="retake-panel">
                <span className="retake-icon"><Replay /></span>
                <div><strong>Try another photo</strong><span>Use a clear, close view of one tomato leaf.</span></div>
                <button type="button" className="text-button" onClick={resetDiagnosis}>Retake</button>
              </div>
            ) : lowConfidence ? (
              <div className="caution-panel">
                <WarningOutlined />
                <span>Wait for a clearer result before using any treatment guidance.</span>
              </div>
            ) : (
              <div className="advice-grid">
                <section className="advice-block">
                  <p className="eyebrow">WHAT TO LOOK FOR</p>
                  <p>{treatment?.symptoms || treatment?.message}</p>
                  {treatment?.cause && <p className="muted-copy">{treatment.cause}</p>}
                </section>

                {treatment?.no_cure ? (
                  <section className="advice-block management-block">
                    <p className="eyebrow">MANAGEMENT</p>
                    <p className="notice-copy">There is no curative treatment for this virus.</p>
                    <ul>{treatment.management_steps?.map((step) => <li key={step}>{step}</li>)}</ul>
                  </section>
                ) : healthy ? (
                  <section className="advice-block">
                    <p className="eyebrow">GENERAL CARE</p>
                    <ul>{treatment.general_care_tips?.map((tip) => <li key={tip}>{tip}</li>)}</ul>
                  </section>
                ) : (
                  <>
                    <section className="advice-block">
                      <p className="eyebrow">MANAGEMENT</p>
                      <ul>{treatment?.organic_treatment?.map((step) => <li key={step}>{step}</li>)}</ul>
                    </section>
                    <section className="advice-block">
                      <p className="eyebrow">ACTIVE INGREDIENTS</p>
                      {treatment?.chemical_active_ingredients?.length ? (
                        <>
                          <ul>{treatment.chemical_active_ingredients.map((ingredient) => <li key={ingredient}>{ingredient}</li>)}</ul>
                          <p className="muted-copy">Follow the product label and local agricultural guidance.</p>
                        </>
                      ) : <p>Non-chemical management is recommended.</p>}
                    </section>
                  </>
                )}

                {!healthy && !treatment?.no_cure && (
                  <section className="advice-block prevention-block">
                    <p className="eyebrow">PREVENTION</p>
                    <ul>{treatment?.prevention?.map((step) => <li key={step}>{step}</li>)}</ul>
                  </section>
                )}
              </div>
            )}

            {!lowConfidence && !unrecognized && !healthy && treatment?.requires_purchase && (
              <section className="nearby-section">
                <div className="nearby-heading">
                  <div>
                    <p className="eyebrow">LOCAL SUPPORT</p>
                    <h3>People near {growthPoint}</h3>
                  </div>
                  <LocationOnOutlined />
                </div>
                {result.location_results?.extension_offices?.length > 0 ? (
                  <div className="place-list">
                    <p className="place-type">Agricultural extension offices</p>
                    {result.location_results.extension_offices.map((place) => <PlaceRow key={place.name + place.address} place={place} />)}
                  </div>
                ) : null}
                {result.location_results?.agro_dealers?.length > 0 ? (
                  <div className="place-list">
                    <p className="place-type">Agro-dealers</p>
                    {result.location_results.agro_dealers.map((place) => <PlaceRow key={place.name + place.address} place={place} />)}
                  </div>
                ) : null}
                {!result.location_results?.available && (
                  <p className="muted-copy">Nearby search is unavailable. Ask your local agricultural extension office for guidance.</p>
                )}
                {result.location_results?.available
                  && !result.location_results.extension_offices?.length
                  && !result.location_results.agro_dealers?.length && (
                    <p className="muted-copy">No nearby offices or agro-dealers were found for this area.</p>
                  )}
              </section>
            )}

            {result.diagnosis_id && (
              <>
                <section className="follow-up-section">
                  <div className="follow-up-heading">
                    <div>
                      <p className="eyebrow">FOLLOW-UP</p>
                      <h3>Stay with this diagnosis</h3>
                    </div>
                  </div>
                  <div className="follow-up-modes" role="group" aria-label="Follow-up action">
                    <button type="button" aria-pressed={followUpMode === "question"} onClick={() => setFollowUpMode("question")}>Ask</button>
                    <button type="button" aria-pressed={followUpMode === "location"} onClick={() => setFollowUpMode("location")}>Update area</button>
                    <button type="button" aria-pressed={followUpMode === "new_photo"} onClick={() => setFollowUpMode("new_photo")}>New photo</button>
                  </div>

                  {followUpMode === "question" && (
                    <div className="follow-up-input-row">
                      <input
                        aria-label="Question about this diagnosis"
                        maxLength="1000"
                        value={followUpMessage}
                        onChange={(event) => setFollowUpMessage(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            sendFollowUp();
                          }
                        }}
                        placeholder="Ask about symptoms, management or prevention"
                      />
                      <button className="follow-up-submit" type="button" onClick={sendFollowUp} disabled={followUpBusy} aria-label="Send question">
                        {followUpBusy ? <span className="button-spinner" /> : <SendOutlined fontSize="small" />}
                      </button>
                    </div>
                  )}

                  {followUpMode === "location" && (
                    <div className="follow-up-action-row">
                      <span>Uses the area selected above: {growthPoint}, {district}, {province}</span>
                      <button className="secondary-button" type="button" onClick={sendFollowUp} disabled={followUpBusy || !province || !district || !growthPoint.trim()}>
                        {followUpBusy ? "Searching" : "Refresh nearby support"}
                      </button>
                      {!result.location_results?.available && <p className="muted-copy">Location search requires Google Places and a saved diagnosis.</p>}
                    </div>
                  )}

                  {followUpMode === "new_photo" && (
                    <div className="follow-up-action-row">
                      <label className="secondary-button file-button" htmlFor="follow-up-photo">
                        <AddAPhotoOutlined fontSize="small" /> {followUpFile ? "Replace photo" : "Choose a new photo"}
                      </label>
                      <input
                        id="follow-up-photo"
                        className="visually-hidden"
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={(event) => setFollowUpFile(event.target.files?.[0] || null)}
                      />
                      {followUpFile && <span className="follow-up-file-name">{followUpFile.name}</span>}
                      <button className="secondary-button" type="button" onClick={sendFollowUp} disabled={followUpBusy || !followUpFile}>
                        {followUpBusy ? "Checking leaf" : "Check new photo"}
                      </button>
                    </div>
                  )}

                  {followUpReply && <p className="follow-up-reply" role="status">{followUpReply.response_text}</p>}
                </section>

                {!lowConfidence && !unrecognized && !healthy && (
                  <section className="feedback-section">
                    <div>
                      <p className="eyebrow">TREATMENT FEEDBACK</p>
                      <h3>Did this guidance help?</h3>
                    </div>
                    {feedback ? (
                      <p className="feedback-confirmation"><CheckCircleOutline /> {feedback}</p>
                    ) : (
                      <div className="feedback-actions">
                        <button type="button" onClick={() => sendFeedback(true)} disabled={feedbackBusy}>Yes</button>
                        <button type="button" onClick={() => sendFeedback(false)} disabled={feedbackBusy}>Not yet</button>
                      </div>
                    )}
                  </section>
                )}
              </>
            )}

            <button className="new-check-button" type="button" onClick={resetDiagnosis}>
              <Replay fontSize="small" /> Check another leaf
            </button>
          </section>
        )}
      </main>

      <footer className="page-footer">
        <span>OGK <span className="footer-divider">/</span> AgriAgent</span>
        <span>Tomato crop support</span>
      </footer>
    </div>
  );
}

function PlaceRow({ place }) {
  return (
    <div className="place-row">
      <div className="place-copy">
        <strong>{place.name}</strong>
        {place.address && <span>{place.address}</span>}
        {place.phone && <a href={`tel:${place.phone}`}>{place.phone}</a>}
      </div>
      {place.maps_url && (
        <a className="map-link" href={place.maps_url} target="_blank" rel="noreferrer" aria-label={`Open ${place.name} in Maps`}>
          <ArrowForward fontSize="small" />
        </a>
      )}
    </div>
  );
}

export default App;

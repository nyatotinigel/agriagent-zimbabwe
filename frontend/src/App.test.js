import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import App from './App';

let container;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  window.localStorage.clear();
  window.URL.createObjectURL = jest.fn(() => 'blob:tomato-leaf');
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ Harare: ['Harare'] }) })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        predicted_class: 'Tomato_Early_blight',
        confidence: 0.87,
        triage_status: 'confident',
        treatment: {
          common_name: 'Early blight',
          symptoms: 'Ringed brown spots on older leaves.',
          organic_treatment: ['Remove affected leaves.'],
          chemical_active_ingredients: ['Mancozeb'],
          prevention: ['Water at the base of plants.'],
          requires_purchase: true,
        },
        location_results: { available: false, extension_offices: [], agro_dealers: [] },
        response_text: 'Likely diagnosis: Early blight (87% confidence).',
        diagnosis_id: '00000000-0000-0000-0000-000000000001',
        persistence_status: 'saved',
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        diagnosis_id: '00000000-0000-0000-0000-000000000001',
        follow_up_intent: 'diagnosis_question',
        response_text: 'Early blight is caused by a fungal infection that can remain in crop debris.',
      }),
    });
});

afterEach(() => {
  ReactDOM.unmountComponentAtNode(container);
  container.remove();
});

test('submits a tomato leaf photo and displays the diagnosis', async () => {
  await act(async () => {
    ReactDOM.render(<App />, container);
    await Promise.resolve();
  });

  expect(container.querySelector('h1').textContent).toBe('Leaf diagnosis');
  const leafImage = new File(['leaf image'], 'tomato-leaf.jpg', { type: 'image/jpeg' });
  const imageInput = container.querySelector('#leaf-photo');
  Object.defineProperty(imageInput, 'files', { configurable: true, value: [leafImage] });
  await act(async () => {
    imageInput.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });

  const province = container.querySelector('#province');
  province.value = 'Harare';
  await act(async () => province.dispatchEvent(new Event('change', { bubbles: true })));
  const district = container.querySelector('#district');
  district.value = 'Harare';
  await act(async () => district.dispatchEvent(new Event('change', { bubbles: true })));
  const growthPoint = container.querySelector('#growth-point');
  growthPoint.value = 'Mbare';
  await act(async () => growthPoint.dispatchEvent(new Event('change', { bubbles: true })));

  await act(async () => {
    container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(Array.from(container.querySelectorAll('h2')).some((heading) => heading.textContent === 'Early blight')).toBe(true);
  expect(container.textContent).toContain('Mancozeb');
  expect(container.textContent).toContain('Likely diagnosis: Early blight');

  const question = container.querySelector('[aria-label="Question about this diagnosis"]');
  const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setInputValue.call(question, 'What causes this disease?');
  await act(async () => question.dispatchEvent(new Event('input', { bubbles: true })));
  await act(async () => {
    container.querySelector('.follow-up-submit').click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(container.textContent).toContain('Early blight is caused by a fungal infection');
  expect(global.fetch).toHaveBeenCalledTimes(3);
});

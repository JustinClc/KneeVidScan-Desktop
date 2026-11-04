import numpy as np
import pandas as pd
import csv
import matplotlib.pyplot as plt
import shap


class shap_model_interpreter:
    def __init__(self, model, X_train, feature_list, model_api='non-sklearn'):
        self.model = model
        self.feature_list = feature_list
        self.X_train = X_train
        if model_api == 'non-sklearn':
            self.X_train_summary = shap.kmeans(self.X_train, 10)
            self.explainer = shap.KernelExplainer(self.model.predict, self.X_train_summary)
        else:
            self.explainer = shap.TreeExplainer(self.model)
        
    def local_interp(self, x_inference, show_high_risk_only=False):
        shap.getjs()
        shap_values = self.explainer.shap_values(x_inference)
        #shap.force_plot(self.explainer.expected_value, shap_values, x_inference)
        exclude_list = ['Age', 'Sex', 'Habit of Smoking', 'Work Activity Level', 
                        'Stroke History', 'Knee Alignment: Neutral']
        exclude_idx = [i for i, item in enumerate(self.feature_list) if item in exclude_list]
        self.feature_list = np.delete(self.feature_list, exclude_idx)
        x_inference = np.delete(x_inference, exclude_idx)
        shap_values = np.delete(shap_values, exclude_idx)
        
        sort_idx = np.argsort(shap_values)
        x_inference = x_inference[sort_idx]
        self.feature_list = self.feature_list[sort_idx]
        shap_values = shap_values[sort_idx]
        
        shap_threshold = 0.001

        if show_high_risk_only:
            feature_list_display = self.feature_list[shap_values > shap_threshold]
            shap_values = shap_values[shap_values > shap_threshold]
        else:
            feature_list_display = self.feature_list
            shap_values = shap_values
        
        no_high_risk_factor = len(shap_values) == 0

        self.feat_value_df = pd.DataFrame({'Risk Factor': self.feature_list[::-1],
                                           'Input': x_inference[::-1]})
        self.feat_value_df.replace({1: 'Yes', 0: 'No'}, inplace=True)

        return feature_list_display, shap_values, no_high_risk_factor
    
    def global_interp(self, x_test):
        shap.getjs()
        shap_values = self.explainer.shap_values(x_test)
        shap.summary_plot(shap_values, x_test, max_display=x_test.shape[1])
        
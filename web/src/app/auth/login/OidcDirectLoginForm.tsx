"use client";

import { usePopup } from "@/components/admin/connectors/Popup";
import { oidcDirectLogin, oidcDirectRegister } from "@/lib/user";
import { Form, Formik, Field, ErrorMessage } from "formik";
import * as Yup from "yup";
import { useState } from "react";
import { Spinner } from "@/components/Spinner";
import { validateInternalRedirect } from "@/lib/auth/redirectValidation";
import { FiEye, FiEyeOff } from "react-icons/fi";

interface OidcDirectLoginFormProps {
  nextUrl?: string | null;
  allowRegistration?: boolean;
}

interface FloatingInputProps {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
}

const FloatingInput = ({ name, label, type = "text", placeholder }: FloatingInputProps) => {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword ? (showPassword ? "text" : "password") : type;

  return (
    <div className="relative mb-2 w-full">
      <div className="relative">
        <span className="absolute px-1 bg-black -top-2 left-3 text-xs font-light text-[#EEEEEE] tracking-wide z-10">
          {label}
        </span>
      </div>
      <div className="w-full flex items-center border border-[#505050] rounded-md bg-transparent focus-within:border-[#965CDE]">
        <Field
          name={name}
          type={inputType}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-xs text-[#EEEEEE] placeholder-[#808080] font-light outline-none px-3 py-3 rounded-md"
          autoComplete={isPassword ? "current-password" : "off"}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="px-3 text-[#808080] hover:text-[#EEEEEE] transition-colors"
          >
            {showPassword ? <FiEye size={16} /> : <FiEyeOff size={16} />}
          </button>
        )}
      </div>
      <ErrorMessage
        name={name}
        component="div"
        className="text-[#EC7575] text-xs mt-1"
      />
    </div>
  );
};

export default function OidcDirectLoginForm({
  nextUrl,
  allowRegistration = true,
}: OidcDirectLoginFormProps) {
  const { popup, setPopup } = usePopup();
  const [isWorking, setIsWorking] = useState<boolean>(false);
  const [isSignup, setIsSignup] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string>("");

  const validationSchema = Yup.object().shape({
    email: Yup.string()
      .email("Please enter a valid email address")
      .required("Email is required")
      .transform((value) => value.toLowerCase()),
    password: Yup.string()
      .required("Password is required")
      .min(8, "Password must be at least 8 characters"),
    ...(isSignup && {
      firstName: Yup.string().required("First name is required"),
      lastName: Yup.string().required("Last name is required"),
      confirmPassword: Yup.string()
        .required("Please confirm your password")
        .oneOf([Yup.ref("password")], "Passwords must match"),
    }),
  });

  return (
    <div className="flex flex-col justify-center items-center w-full h-full">
      {isWorking && <Spinner />}
      {popup}

      {/* Header */}
      <div className="mb-16 text-center">
        <div className="flex justify-center items-center mb-3">
          <span className="text-[2rem] font-medium text-white tracking-wide leading-none">
            {isSignup ? "Create account" : "Hey, hello"}
          </span>
          {!isSignup && <span className="ml-2 text-3xl">&#128075;</span>}
        </div>
        <p className="text-xs text-[#B3B3B3]">
          {isSignup
            ? "Enter your details to create a new account"
            : "Enter your email and password to access your account"}
        </p>
      </div>

      <Formik
        initialValues={{
          email: "",
          firstName: "",
          lastName: "",
          password: "",
          confirmPassword: "",
        }}
        validateOnChange={false}
        validateOnBlur={true}
        validationSchema={validationSchema}
        onSubmit={async (values) => {
          const email = values.email.toLowerCase();
          setIsWorking(true);
          setAuthError("");

          try {
            let response: Response;

            if (isSignup) {
              response = await oidcDirectRegister(
                email,
                values.password,
                values.firstName,
                values.lastName
              );
            } else {
              response = await oidcDirectLogin(email, values.password);
            }

            if (response.ok) {
              const validatedNextUrl = validateInternalRedirect(nextUrl);
              window.location.href = validatedNextUrl
                ? validatedNextUrl
                : `/chat${isSignup ? "?new_team=true" : ""}`;
            } else {
              let errorMsg = "Unknown error";

              try {
                const errorData = await response.json();
                if (typeof errorData.detail === "string") {
                  errorMsg = errorData.detail;
                } else if (
                  typeof errorData.detail === "object" &&
                  errorData.detail.reason
                ) {
                  errorMsg = errorData.detail.reason;
                }
              } catch {
                if (response.status === 401) {
                  errorMsg = "Invalid email or password";
                } else if (response.status === 400) {
                  errorMsg = isSignup
                    ? "Account creation failed"
                    : "Login failed";
                } else if (response.status === 429) {
                  errorMsg = "Too many requests. Please try again later.";
                }
              }

              setAuthError(errorMsg);
              setPopup({
                type: "error",
                message: `${isSignup ? "Sign up" : "Login"} failed - ${errorMsg}`,
              });
            }
          } catch (error) {
            setAuthError("An unexpected error occurred. Please try again.");
            setPopup({
              type: "error",
              message: "An unexpected error occurred. Please try again.",
            });
          } finally {
            setIsWorking(false);
          }
        }}
      >
        {({ isSubmitting, resetForm }) => (
          <Form className="w-[50%]">
            <FloatingInput
              name="email"
              label="Email"
              type="email"
              placeholder="Enter email"
            />

            {isSignup && (
              <div className="flex gap-4 w-full">
                <div className="flex-1 min-w-0">
                  <FloatingInput
                    name="firstName"
                    label="First Name"
                    type="text"
                    placeholder="John"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <FloatingInput
                    name="lastName"
                    label="Last Name"
                    type="text"
                    placeholder="Doe"
                  />
                </div>
              </div>
            )}

            <FloatingInput
              name="password"
              label="Password"
              type="password"
              placeholder="Enter password"
            />

            {isSignup && (
              <FloatingInput
                name="confirmPassword"
                label="Confirm Password"
                type="password"
                placeholder="Confirm password"
              />
            )}

            {/* Login Button */}
            <button
              type="submit"
              disabled={isSubmitting || isWorking}
              className="w-full mt-4 py-3 px-4 text-xs font-semibold text-[#EEEEEE] rounded-md transition-colors
                bg-[#1E0C34] border border-[#965CDE] hover:bg-[#965CDE]
                disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSignup ? "Sign Up" : "Login"}
            </button>

            {/* Toggle Sign Up / Login */}
            {allowRegistration && (
              <div className="mt-6 text-center w-full">
                <span className="text-xs text-[#B3B3B3]">
                  {isSignup ? "Already have an account? " : "Don't have an account? "}
                </span>
                <span
                  onClick={() => {
                    setIsSignup(!isSignup);
                    setAuthError("");
                    resetForm();
                  }}
                  className="text-xs text-[#965CDE] font-medium cursor-pointer hover:underline"
                >
                  {isSignup ? "Log In" : "Sign Up"}
                </span>
              </div>
            )}

            {/* Error Display */}
            {authError && (
              <div
                className="mt-6 border border-[#EC7575] rounded-md px-4 py-3 flex justify-center items-center"
                style={{ backgroundColor: "rgba(236, 117, 117, 0.1)" }}
              >
                <span className="text-xs text-[#EC7575]">{authError}</span>
              </div>
            )}
          </Form>
        )}
      </Formik>
    </div>
  );
}

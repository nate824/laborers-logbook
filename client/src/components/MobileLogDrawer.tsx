import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerTrigger,
} from "@/components/ui/drawer";

interface MobileLogDrawerProps {
  buttonLabel: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  children: (close: () => void) => ReactNode;
}

// A large, tile-style bottom sheet for logging an entry on mobile. The trigger
// is a big full-width button; the body scrolls and enlarges form controls so
// inputs, selects and date pickers are comfortable to use with a thumb.
export function MobileLogDrawer({
  buttonLabel,
  title,
  description,
  icon,
  children,
}: MobileLogDrawerProps) {
  const [open, setOpen] = useState(false);

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button
          type="button"
          size="lg"
          className="w-full h-16 rounded-xl px-3 text-base font-semibold shadow-sm"
        >
          {icon && <span className="mr-2 flex items-center">{icon}</span>}
          {buttonLabel}
        </Button>
      </DrawerTrigger>
      <DrawerContent className="max-h-[92vh]">
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-xl">{title}</DrawerTitle>
          <DrawerDescription>{description ?? ""}</DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-8 [&_input]:h-12 [&_input]:text-base [&_textarea]:text-base [&_[role=combobox]]:h-12 [&_[role=combobox]]:text-base">
          {children(() => setOpen(false))}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

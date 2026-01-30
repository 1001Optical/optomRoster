import {RiArrowDropDownLine} from "react-icons/ri"
import {useState, useRef, useEffect} from "react";

type ItemType = { key: number; value: string }

interface ISelectProps {
    selectItem?: number;
    items: ItemType[];
    onSelect: (key?: number) => void
}
interface IOptionProps {
    item: ItemType;
    onClick: (key: number) => void
}

const IooIOption = ({item, onClick}: IOptionProps) => {
    return <div className={"py-2 px-3 hover:bg-gray-100 cursor-pointer"} onClick={() => onClick(item.key)}>
        <p>{item.value}</p>
    </div>
}

const IooISelect = ({selectItem, items = [], onSelect}: ISelectProps) => {
    const [isOpen, setIsOpen] = useState(false)
    const selectRef = useRef<HTMLDivElement>(null)

    // 외부 클릭 감지
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        }

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside)
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [isOpen])

    return <div className={"relative"} ref={selectRef}>
        {/* select 선택 창*/}
        <div
            className={"w-[212px] flex justify-between items-center border border-gray-300 px-3 py-1 gap-2 rounded-xl cursor-pointer "}
            onClick={() => setIsOpen(!isOpen)}
        >
            <p>{selectItem ? items.find(v => v.key === selectItem)?.value : "Select Store"}</p>
            <RiArrowDropDownLine />
        </div>
        {
            isOpen && (
                <div className={"absolute w-[212px] max-h-[300px] bg-white border border-gray-300 rounded-xl top-10 overflow-scroll z-20"}>
                    {
                        items.length
                            ? <div>
                                <IooIOption key={"all"} item={{key:0, value: "ALL"}} onClick={() => {
                                    onSelect(undefined)
                                    setIsOpen(false)
                                }}/>
                                {
                                    items.map((item) => <IooIOption key={item.key} item={item} onClick={(key) => {
                                        onSelect(key)
                                        setIsOpen(false)
                                    }} />)
                                }
                                </div>
                            : <div className={"py-8 px-3 text-center text-gray-400"}>NO DATA</div>
                    }
                </div>
            )
        }
    </div>
}

export default IooISelect;